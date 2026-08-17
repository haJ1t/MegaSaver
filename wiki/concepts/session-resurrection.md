---
title: Session Resurrection
category: concept
tags:
  - contextops
  - resurrection
  - resume
  - tokenops
updated: 2026-08-17
---

# Session Resurrection (`mega resume`)

> **Quick summary:** `mega resume <sessionId>` / `mega resume --last` rebuilds a dead or crashed session's working state into a bounded ($\le 2,000$ tokens, $\le 9,000$ characters), redacted, evidence-preserving kickoff capsule without replaying conversations or re-reading unchanged files.

---

## 1. Problem Statement

When an agent session terminates abruptly (crash, process termination, terminal window closed), the uncommitted work, read-index file hashes, executed command outputs, and intent remain in the store. However, a newly spawned session starts with amnesia and re-reads entire repositories or re-executes tests, wasting tokens and wall-clock time.

---

## 2. Architecture & Modes

`mega resume` operates in four modes:

1. **stdout (default):** Prints the formatted markdown capsule to stdout for developer inspection.
2. **`--copy`:** Copies the capsule text to the system clipboard (on Darwin using `pbcopy`) and prints to stdout.
3. **`--next`:** Queues a pending resurrection capsule at `stats/<workspaceKey>/resume-capsule.json` (0700 dir, 0600 file). Upon the next session's first user prompt, `prepareTaskKickoff` consumes the capsule via atomic rename-claim and delivers it in `hookSpecificOutput.additionalContext`.
4. **`--json`:** Emits structured JSON containing `sessionId`, `layout`, `lastActivityAt`, `liveness`, `tokenCount`, and `text`.

---

## 3. Storage Layout Resolution & Source Gathering

- **Dual-Layout Resolution:**
  - **Registry Layout:** `content/<projectId>/<sessionId>/`
  - **Overlay Layout:** `content/<workspaceKey>/<liveSessionId>/`
- **Read-Index Freshness:** Compares stored SHA-256 hashes against real file contents to classify working set files as `unchanged`, `changed`, `missing`, or `unknown`.
- **Liveness Gate:**
  - If a fresh mesh presence file exists (`mesh/presence/<liveSessionId>.json` within 10 minutes), resurrection is refused (exit 1) to prevent double-agent collisions.
  - If activity occurred in the last 10 minutes without mesh presence, a warning is emitted on stderr, but resurrection proceeds.

---

## 4. Key Contracts & Invariants

- **Dual Budget Cap:** The rendered capsule strictly obeys $\le 2,000$ tokens (`TASK_KICKOFF_TOKEN_CAP`) and $\le 9,000$ characters (`TASK_KICKOFF_CHARACTER_CAP`).
- **Greedy Dual-Cap Fill:** Excess file pointers or outputs are dropped whole, never chopped.
- **Fail-Open Gather:** Missing or unreadable store records degrade to labeled omission notes (e.g. `(no stats recorded)`), never throwing.
- **Redaction Fixed Point:** Final capsule text is passed through `redact()` from `@megasaver/policy` before output or persistence.
