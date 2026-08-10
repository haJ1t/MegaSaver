---
feature: structured-blackboard
date: 2026-08-06
risk: HIGH
status: draft-design
pending: [user-spec-review, architect-pass]
reviewers: [code-reviewer, critic]
build-order: "4 of 11 (next-wave batch)"
---

# Structured Blackboard (A3)

## Problem

Concurrent agent sessions share discovered facts ("tests failing on
X since commit Y", "API Z returns 429 on batch>10") through a
hand-edited `wiki/agent-channel.md`: free text, no metadata, no
expiry, no contradiction handling, and every live session re-derives
what a peer already paid for (pains P1/P6, vibe-coding-pains-2026).
The Session Mesh (build order 1) gives sessions presence, a bus, and
inboxes — but messages are directed and transient. There is no
shared, structured, *live* fact store that all sessions inherit.

## Goal

Any Mega Saver-connected session posts a structured fact once; all
live sessions in the same repo inherit it. Every fact carries the
mandatory §13 metadata: source, timestamp, confidence, scope,
expires (or null). Facts are session-scoped/ephemeral by default;
durable promotion goes only through the existing memory engine and
its human approval gate. Contradicting facts are flagged, never
silently overwritten. Surfaces: CLI (`mega board`), MCP tools for
hook-less agents, and bounded hook injection of high-confidence
facts into session context.

## Non-Goals (YAGNI)

- No LLM extraction of facts from transcripts — facts are posted
  explicitly (CLI, MCP, or a peer agent's own tooling).
- No automatic contradiction resolution — humans/agents resolve via
  `mega board resolve`; the board only flags.
- No blocking/enforcement; the board is advisory, fail-open.
- No cross-machine or team sync (brain-sync is separate).
- No GUI panel in v1 (store layout is watchable; panel later).
- No query language: filters are repo, topic, status, confidence.
- No board-native durability: durable = promoted memory entry, full
  stop. The board itself is GC'd.
- No new transport: bus events and store layout come from the
  Session Mesh spec (2026-08-06-session-mesh-design.md).

## Locked Decisions

1. **Module placement: inside `@megasaver/mesh`** (`src/board/`).
   The board shares the mesh store root, event bus, GC cycle, and
   repo identity. A separate package would need mesh internals that
   are not public API. Core stays agent-agnostic and untouched.
2. **Files are truth; one file per fact.** Facts live at
   `store/mesh/board/<factId>.json`, written atomically
   (tmp + rename, intent-hook precedent). Posting/resolving also
   appends a mesh bus event (`board_fact_posted` /
   `board_fact_resolved`) via the mesh `postEvent` seam so live
   consumers ride the existing transport — never a second bus.
3. **§13 metadata is schema-enforced.** `boardFactSchema` requires:
   `source` (posting `liveSessionId` + agent label; the id field
   reuses the mesh presence name, never a divergent alias),
   `createdAt` (ISO),
   `confidence` (`low|medium|high`), `scope` (repo key + optional
   repo-relative paths), `expiresAt` (ISO datetime **or null** —
   the field itself is required). Default TTL 24 h; `--ttl 0`
   writes an explicit `null` (no expiry).
4. **Contradiction is flagged, not merged.** A new active fact on
   the same normalized topic (trim, lowercase, collapse whitespace)
   from a *different* session marks **both** facts
   `status: disputed` and cross-links them (`disputedWith`).
   Neither is dropped. A *same-session* repost on its own topic
   supersedes the poster's earlier fact (old one auto-resolved with
   a stamped note) — self-correction is not a contradiction.
5. **Ephemeral by default; durability only via the memory gate.**
   `mega board promote <factId>` builds a `MemoryEntry` with
   `approval: "suggested"` through `saveMemoryWithLineage`
   (`packages/core/src/supersession.ts:220`); a human approves via
   the existing `mega memory approve` / `approve_memory` gate
   (Phase 10). The board never auto-approves. The fact is stamped
   `promotedTo: <memoryEntryId>`.
6. **Bounded, high-confidence-only injection.** SessionStart digest
   plus a PreToolUse delta (new facts since the per-session
   cursor), each capped at `BOARD_INJECT_MAX_TOKENS = 500` using
   the ~4 bytes/token estimate (context-gate
   `record-output.ts:228` precedent). Only `active` + `high`
   confidence + unexpired facts inject; `disputed` never injects.
   Delta checks are debounced (`BOARD_DELTA_CHECK_INTERVAL_MS =
   30_000`) so the hot path pays one small cursor read.
7. **Repo-scoped via the git common dir.** v1 repo key =
   `encodeWorkspaceKey(<git common dir>)`, falling back to
   `encodeWorkspaceKey(cwd)` outside a repo — worktrees of one repo
   share a board. Swaps to the mesh canonical family identity
   (`familyKeyFromPath`, `packages/context-gate/src/
   family-identity.ts:46`) when mesh lands its resolver (open
   question 3).
8. **Fail-open + SECRET-REDACT, warn-only.** All user text (fact
   text, topic, resolution notes) passes `redact()`
   (`packages/policy/src/redact.ts:44`) before persist; a nonzero
   redaction count warns on stderr but never blocks. Hook entry
   points always exit 0. Board module imports no `@megasaver/core`
   (content-store-no-core-edge precedent); promotion lives in the
   CLI/MCP layers that already depend on core.

## Architecture

```
store/mesh/
  board/<factId>.json          one fact, atomic write
  board-cursor/<liveSessionId>.json  {lastInjectedAt, lastCheckedAt}
  events.jsonl                 + board_fact_posted / _resolved
```

Writers: CLI, MCP tools, hooks. Readers: same. Contradiction check
is a directory scan filtered to active facts with the same
normalized topic and repo key (board dirs stay small; GC enforces).

## Components

1. **Board module** (`packages/mesh/src/board/`): `boardFactSchema`,
   `normalizeTopic`, `resolveBoardRepoKey`, `postFact`,
   `readBoardFacts`, `resolveFact`, `selectFactsForInjection`,
   `renderBoardDigest`, `boardGc` (hooked into mesh `gc()`).
   `postFact` takes an injected `postEvent` callback so the module
   never hard-imports mesh event internals.
2. **CLI** (`apps/cli/src/commands/board/`): `mega board post
   "<text>" --topic <t> [--confidence low|medium|high] [--ttl <h>]
   [--path <p>]...`, `mega board list [--all] [--topic] [--status]`,
   `mega board resolve <factId> [--note]`, `mega board promote
   <factId> --project <name>`. Citty pattern per
   wiki/workflows/cli-test-pattern.md; registered in
   `apps/cli/src/main.ts` subCommands.
3. **Hooks** (`apps/cli/src/hooks/board-run.ts`, command
   `mega hooks board`): one handler branching on
   `hook_event_name` — SessionStart → digest injection
   (`hookSpecificOutput.additionalContext`, warmup-run precedent);
   PreToolUse → debounced delta injection (guard-run precedent).
   Wired by `mega hooks install` (`--no-board` opt-out) via the
   managed settings block.
4. **MCP tools** (`board_post`, `board_list`, `board_resolve`):
   added to `mcpToolNameSchema` (alphabetic), one file per tool
   under `packages/mcp-bridge/src/tools/`, registered in
   `TOOL_INPUT_SCHEMAS` + `TOOL_DEFS` + `dispatch`. Names contain
   no `mega_` prefix so both naming modes expose them unchanged
   (tool-naming.ts pass-through). Hook-less agents promote via the
   existing `save_memory` (suggested) + `approve_memory` path — no
   `board_promote` tool in v1.

## Error handling

- Hook entry: catch-all → exit 0, empty stdout; stdin capped at
  256 KiB (intent-hook precedent).
- Corrupt fact/cursor JSON → move to `store/mesh/quarantine/` and
  continue (mesh precedent); a read never throws on one bad file.
- Expired facts filtered at read time; physically removed by
  `boardGc` (expired, or resolved > 7 d).
- CLI errors follow `mapErrorToCliMessage` conventions; exit 1 with
  a single stderr line, never a stack trace.

## Security & privacy

- `redact()` on fact text, topic, and resolution notes before any
  persist; warn-only (report count, proceed with redacted text).
- Store files 0600, dirs 0700 (intent-hook precedent). No network.
- Scope paths are repo-relative only; absolute paths rejected.
- Injected facts are labeled untrusted peer data in the
  `additionalContext` template — data, not instructions.

## Testing

- Unit: schema §13-field enforcement (missing `expiresAt` rejects);
  topic normalization; contradiction matrix (cross-session dispute,
  same-session supersede, different topic no-op); TTL/expiry;
  injection selection (confidence + status + budget cutoff);
  redaction applied before write; quarantine on corrupt file.
- Integration: two simulated sessions on a temp store — post →
  peer list sees it → conflicting post → both disputed → resolve →
  promote → suggested memory exists, approval untouched.
- CLI handler tests per cli-test-pattern; hook tests mirror
  `apps/cli/test/hooks/intent-run.test.ts` (stdin fixture, temp
  XDG store).
- No timing-tight assertions: structural guards and wide windows
  (CI-slowness discipline); debounce tested by cursor state, not
  wall-clock races.

## Risk & process (§12 HIGH)

Session storage format + hook injection path + memory-gate
adjacency ⇒ HIGH. Chain: this spec → user spec review → architect
pass (fresh context) → plan → worktree `feat/structured-blackboard`
→ TDD → `code-reviewer` AND `critic` separate passes → verifier
evidence. Evidence-preserving mode only.

## Dependencies / build order

- **Hard prerequisite:** Session Mesh plan (build order 1) merged —
  `@megasaver/mesh` package skeleton, store root layout, `postEvent`
  seam, mesh `gc()`.
- Reuses: `redact` (policy), `encodeWorkspaceKey` + id brands
  (shared), `saveMemoryWithLineage` + approval gate (core),
  `ensureStoreReady` (cli store.ts), hook install managed block,
  MCP tool registration pattern.
- Enables: A6 peer Q&A (facts as answer provenance), C-cluster
  claim-verification (facts carrying run receipts).

## Open questions (tracked, non-blocking)

1. `BOARD_INJECT_MAX_TOKENS = 500` — tune after dogfood.
2. Should disputed facts inject with an explicit conflict banner
   instead of being withheld? v1 withholds; revisit with evidence.
3. Adopt mesh canonical repo-family identity for `scope.repo` once
   its resolver lands (replaces the git-common-dir workspace key).
4. MCP `board_post` requires explicit `liveSessionId`/`agent` fields
   until the mesh MCP session binding lands; then they default.
