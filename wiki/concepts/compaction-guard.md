---
title: Compaction Guard
category: concept
tags:
  - contextops
  - hooks
  - compaction
  - tokenops
updated: 2026-08-17
---

# Compaction Guard

> **Quick summary:** Reconnects post-compact coding agents to intra-session overlay receipts without re-running prior tool executions. Captures a work-state snapshot on `PreCompact` (`mega hooks capsule`) and injects bounded recap context on `SessionStart` (`mega hooks recap`, ≤2,000 tokens).

---

## 1. Problem Statement

When frontier coding agents (such as Claude Code) undergo context window compaction mid-session, the compacted conversation loses the exact chunk-set receipts, touched file paths, and executed command outcomes. Consequently, agents frequently repeat expensive commands or re-read unchanged files, burning tokens and introducing latency.

---

## 2. Architecture & Flow

Compaction Guard implements a two-stage hook lifecycle:

1. **Snapshot on PreCompact (`mega hooks capsule`)**:
   - Claude Code fires the `PreCompact` hook.
   - The CLI reads the payload on stdin, extracts `session_id` and `cwd`, and derives `workspaceKey`.
   - Enumerates overlay chunk sets using `listOverlayChunkSets`.
   - Reads the latest intent prompt via `readLatestIntentRecord` (TTL-free).
   - Builds and redacts the `WorkStateCapsule` (`work-state-capsule.json`).
   - Atomically saves the capsule in the session store.
   - Exits with status 0 (fail-open, non-blocking).

2. **Recap on SessionStart (`mega hooks recap`)**:
   - Claude Code fires `SessionStart` after compaction with `source === "compact"`.
   - The CLI loads the capsule from the exact `session_id` or searches the workspace for the newest capsule within `RECAP_FALLBACK_WINDOW_MS` (15 minutes).
   - Renders a budget-bounded recap context (strictly ≤ 2,000 tokens using `estimateTokens`).
   - Emits `{ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }` on stdout.
   - For non-compact session starts or errors, emits empty string (no-op).

---

## 3. Storage & Integration

- **Capsule Sibling:** `work-state-capsule.json` is stored alongside chunk sets in `content/<workspaceKey>/<sessionId>/`.
- **Reserved Sibling Invariant:** `listChunkSets`, `listOverlayChunkSets`, and `pruneOlderThan` in `@megasaver/content-store` explicitly skip `CAPSULE_FILENAME` (`work-state-capsule.json`).
- **Silent-Failure Monitor Reconnection:** `loadFailureSnapshot` re-enables `chunkSets` via `listOverlayChunkSets` and `capsule` by reading `work-state-capsule.json`.
- **Connector Configuration:** `packages/connectors/claude-code` installs the PreCompact capsule hook and SessionStart recap hook by default, configurable via `--no-compaction-guard`.

---

## 4. Key Contracts & Invariants

- **Token Budget:** Recap output is guaranteed $\le 2,000$ tokens. Trims oldest receipts if necessary.
- **Fail-Open Policy:** Hook errors never crash or block session execution or compaction.
- **Redaction Invariant:** Prompts, commands, and paths are redacted via `@megasaver/policy` before persisting to disk.
