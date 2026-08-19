---
title: '@megasaver/mesh'
tags: [entity, package, session-mesh, family]
sources:
  - docs/superpowers/specs/2026-08-12-session-mesh-family-design.md
  - docs/superpowers/specs/2026-08-06-session-mesh-design.md
  - docs/superpowers/specs/2026-08-06-structured-blackboard-design.md
  - docs/superpowers/specs/2026-08-06-peer-qa-routing-design.md
  - docs/superpowers/specs/2026-08-06-cross-agent-handoff-design.md
status: active
created: 2026-08-12
updated: 2026-08-19
---

# `@megasaver/mesh`

Session Mesh family (A1→A5) leaf package. Local, file-backed session mesh — files are truth, daemon is optional accelerator. No `@megasaver/core` import.

## Store layout

```
store/mesh/
  presence/<liveSessionId>.json
  events.jsonl                 bus (mesh+board+qa+offer)
  claims/<claimId>.json        advisory claims TTL 30m
  inbox/<liveSessionId>/<msgId>.json  at-most-once
  board/<factId>.json
  board-cursor/<liveSessionId>.json  delta debounce 30s
  ask-state/<senderId>.json    60s rate-limit
  quarantine/                  corrupt-file quarantine
```

All writes atomic `tmp+rename` `0600`/`0700`, torn `events.jsonl` lines skipped, `SAFE_SEGMENT` guards.

## Public surface

- `presenceRecordSchema`, `meshEventSchema` (`message|ask|answer|handoff-offer`), `claimRecordSchema`, `boardFactSchema`, `handoffOfferPointerSchema`.
- `registerSession`, `heartbeat` (debounced ≥5s mtime, fire-and-forget), `setStatus`, `listPeers` (staleness `stale>90s` `dead>10m`, future skew → live), `postEvent`/`readEvents`, `sendMessage`/`drainInbox` (redacted ≤4000, bounded drain ≤5/≤2000 tokens), `claimPaths`/`releaseClaim`/`checkConflicts` (NFA `compileGlob`), `gc` (5MB/7d rotation).
- Board: `postFact`/`readBoardFacts`/`resolveFact`, `normalizeTopic`, `selectFactsForInjection`/`selectBoardDigest` (`BOARD_INJECT_MAX_TOKENS=500`), `formatBoardFacts`.
- Q&A: `askPayloadSchema`/`answerPayloadSchema`, `checkAskRateLimit`/`postAsk`, `extractKeywords`/`matchPeerAnswer`/`renderPeerAnswerHint`.
- Handoff: `HandoffCapabilityProfile` lives in `@megasaver/connectors-shared`, `evaluateHandoffFit` measured on `renderHandoffBlockText`.
- `meshPaths` helper.

## Repo-family scoping

`familyKeyFromPath` (`@megasaver/context-gate`) when Git resolvable, else `encodeWorkspaceKey(cwd)`. Peer queries match `repositoryFamilyKey` when both carry it, else `workspaceKey` equality; `--all` widens.

## CLI

- `mega mesh {status,send,ask,answer,claims,events,gc}` — status supports `--follow`; send `all|broadcast` fans out; ask/answer carry provenance.
- `mega board {post,list,resolve,promote}` — promote via `saveMemoryWithLineage` → `suggested`.
- `mega handoff {peers,offer}` + `open --fit` / `pack` advisory fit line — `peers --packet` reports per-peer `fits|refuses` via `evaluateHandoffFit`; `offer` Pro-gated `hot-handoff`.

## MCP

10 tools: `mesh_claim|events|peers|poll|release|send|status_set` (7) + `board_post|list|resolve` (3) inside `mesh_send` kind routing (`ask`/`answer`/`handoff-offer`).

## Hooks + daemon

Warmup `registerSession`, saver `heartbeat` fire-and-forget, guard `checkConflicts` + `drainInbox` into `additionalContext` (untrusted label, bounded), board digest/delta injection, `mesh-hint` UserPromptSubmit opt-in `--mesh-hints`. Daemon `GET /mesh/status` accelerator (files are truth). Every hook `catch→exit 0`, bounded stdin 256 KiB, `redact()` before persist.

## Related

- [[entities/cli]] — mesh/board/handoff commands.
- [[entities/mcp-bridge]] — mesh/board tools.
- [[entities/daemon]] — `/mesh/status` route.
- [[entities/connectors-shared]] — `HandoffCapabilityProfile`.
- [[concepts/agent-agnostic-core]] — zero agent-specific logic in mesh.
- [[syntheses/vibe-coding-pains-2026]] — A1→A5 pain cluster.
- [[entities/mega-agent]] — consumes mesh as a **client** (presence + `drainInbox` for directed messages). Its Conductor is a role, not a leader: [[decisions/conductor-is-a-role]]. Read that before adding election/claim machinery here.
