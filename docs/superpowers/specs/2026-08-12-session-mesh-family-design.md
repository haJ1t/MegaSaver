---
feature: session-mesh-family
date: 2026-08-12
risk: HIGH
status: approved-design
pending: [architect-pass, critic-pass]
reviewers: [code-reviewer, critic]
build-order: "Session Mesh Family (A1→A5) — sequential 4-phase umbrella"
---

# Session Mesh Family — A1→A5 Unified Design (Hepsi)

## Problem

Parallel agent sessions are islands `wiki/syntheses/vibe-coding-pains-2026.md:22` — no discovery, no messaging, no shared state, no conflict warning. Operator pain is daily: N terminal panes + hand-edited `wiki/agent-channel.md:1` as manual workaround. Multiplexer tools manage panes; nobody owns the agent-agnostic semantic session layer. Existing `session-mission-control` `packages/daemon/src/live-table.ts:1` only reads daemon `live-sessions.json` and shows `working|blocked|done` via `deriveStatus` — it is not a mesh, has no bus, no claims, no inbox, no cross-agent awareness.

User directive 2026-08-12: **Hepsi** (A1→A5) — all session/collaboration sub-pains in one family, sequential delivery.

## Goal

Any Mega Saver-connected session (Claude Code via hooks, any CLI agent via MCP) can:
- (a) announce presence and heartbeat `store/mesh/presence/<liveSessionId>.json`
- (b) discover live peers repo-family-scoped (worktrees of one repo see each other)
- (c) send/receive directed/broadcast messages with at-most-once pull delivery
- (d) claim file paths and get a warn-only conflict hint when touching a path a live peer claimed
- (e) be observed via `mega mesh status --follow` (files are truth, daemon is accelerator)
- (f) post structured live facts with §13 metadata that all live sessions inherit (blackboard)
- (g) ask live peers a question and receive provenance-bearing answers (peer Q&A)
- (h) discover handoff-receivable peers and advertise a pointer-only handoff offer (cross-agent handoff)
Works with zero agent-specific logic in core `concepts/agent-agnostic-core.md:1`.

## Non-Goals (YAGNI)

- Cross-machine / network transport / team sync (local single-machine only).
- Blocking claims, auto-resolving contradictions, auto-answering, auto-accepting handoffs.
- LLM extraction of facts, embeddings for Q&A hints, reputation scoring.
- Killing or terminating sessions (observe-only).
- GUI panels in v1 (store layout is watchable; panels fast-follow).
- Changes to `.megahandoff` packet schema `packages/core/src/handoff-packet.ts:1` — translation is consume-side.

## Locked Decisions

1. **Umbrella + 4 child specs.** This file is the family umbrella. Child specs are authoritative per phase and are inherited, not duplicated:
   - Phase 1 `docs/superpowers/specs/2026-08-06-session-mesh-design.md:1` (A1 bus + A2 claims + A5 live view)
   - Phase 2 `docs/superpowers/specs/2026-08-06-structured-blackboard-design.md:1` (A3 board)
   - Phase 3 `docs/superpowers/specs/2026-08-06-peer-qa-routing-design.md:1` (A6 Q&A)
   - Phase 4 `docs/superpowers/specs/2026-08-06-cross-agent-handoff-design.md:1` (A4 handoff delta over i10 `2026-07-18-hot-handoff-design.md:1`)
   Contradiction rule: this umbrella's contracts win if a child drifts.

2. **Single new package `@megasaver/mesh`.** Phases 2-4 live inside it (`src/board/`, `src/qa/`, `src/handoff-capability.ts` already planned in children). A separate package per child would need mesh internals that are not public API. Core stays untouched `decisions/content-store-no-core-edge.md:1`. Package deps `shared + zod` only (no `core`, no `content-store`).

3. **Files are truth, daemon is accelerator.** Matches Phase 1 LD1 `docs/superpowers/specs/2026-08-06-session-mesh-design.md:47`. Store root is `store/mesh/`:
   ```
   store/mesh/
     presence/<liveSessionId>.json
     events.jsonl                 bus (mesh+board+qa+offer)
     claims/<claimId>.json
     inbox/<liveSessionId>/<msgId>.json
     board/<factId>.json
     board-cursor/<liveSessionId>.json
     ask-state/<senderId>.json
     quarantine/                  corrupt-file quarantine
   ```
   All writes atomic `tmp+rename`, `0600`/`0700` perms, torn `events.jsonl` lines skipped, Windows rename-safe. Daemon adds `GET /mesh/status` only when already running; never spawns for mesh.

4. **Delivery is pull-based, at-most-once, bounded.** Messages land in per-session inbox; Claude Code drains on `guard-run` PreToolUse (bounded `≤5 msgs / ≤2000 tokens` per drain, overflow stays queued), other agents via `mesh_poll` / `mesh_query`. No push into a running agent's context. Fail-open everywhere — every hook entry `catch → exit 0`.

5. **Repo-family scoping by default, `workspaceKey` fallback.** Identity reuses saver `familyKeyFromPath` `packages/context-gate/src/family-identity.ts:46` when resolvable; otherwise `encodeWorkspaceKey(cwd)` `packages/shared/src/*`. Peer queries and `checkConflicts` match on `repositoryFamilyKey` when BOTH records carry it, else `workspaceKey` equality. Sibling worktrees therefore see each other. `--all` widens.

6. **SECRET-REDACT before any persist.** Every user text (messages, task labels, board fact text/topic/notes, questions/answers, offer pointers) passes `redact()` `packages/policy/src/redact.ts:44` before persist, warn-only. Injected `additionalContext` is labeled untrusted peer data, never instructions.

7. **Sequential build order, contract freeze at Phase 1.** Phase 1 freezes `meshMessageKind = message|ask|answer` + `presenceRecordSchema` + `events.jsonl` line format + inbox layout. Phase 2 consumes `postEvent` seam only. Phase 3 reuses `mesh_send` kind routing (no new MCP tool, roster stays 7+board 3). Phase 4 additively extends the kind union with `handoff-offer` (structured offer field) — the only amendment to the Phase 1 union, owned by Phase 4.

## Architecture

```
writes: hooks (SessionStart/PostToolUse/PreToolUse) + MCP tools + CLI  ─┐
                                                                         ├─► store/mesh/ (truth)
reads:  same + daemon GET /mesh/status (accelerator) + GUI bridge ──────┘

Phase1: register/heartbeat/setStatus/listPeers/postEvent/readEvents/sendMessage/drainInbox/claim*/checkConflicts/gc
Phase2: + board: postFact/readBoardFacts/resolveFact/selectFactsForInjection/renderBoardDigest (events: board_fact_posted/_resolved)
Phase3: + qa: askPayloadSchema/answerPayloadSchema/postAsk/checkAskRateLimit/matchPeerAnswer (events: ask/answer)
Phase4: + handoff: HandoffCapabilityProfile/evaluateHandoffFit + peers/offer (events: offer)
```

Hook wiring keeps process count flat (no new `settings.json` entries in Phase 1 — rides `warmup-run`/`saver-run`/`guard-run`); `mega hooks install --no-board/--mesh-hints` opt-outs are managed-block flags.

## Components

### Phase 1 — `@megasaver/mesh` core + CLI + MCP + daemon route
Ref: `docs/superpowers/specs/2026-08-06-session-mesh-design.md:93`. Public API: `registerSession`, `heartbeat` (debounced `≥5s`), `setStatus`, `listPeers`, `postEvent`/`readEvents`, `sendMessage`, `drainInbox`, `claimPaths`/`releaseClaim`/`checkConflicts`, `gc`. CLI `mega mesh status [--all] [--follow]`, `send`, `claims`, `events`, `gc`. MCP 7 tools `mesh_claim/events/peers/poll/release/send/status_set`. Daemon `GET /mesh/status`.

### Phase 2 — Board module inside `@megasaver/mesh/src/board/`
Ref: `docs/superpowers/specs/2026-08-06-structured-blackboard-design.md:108`. `boardFactSchema` enforces §13 `source/createdAt/confidence/scope/expiresAt` (explicit `null` for no-expiry), `normalizeTopic` (trim+lowercase+collapse), cross-session `disputed` vs same-session `supersede`, `selectFactsForInjection` capped `BOARD_INJECT_MAX_TOKENS=500` debounced `30_000ms`, promotion via `saveMemoryWithLineage` → `suggested`. CLI `mega board post/list/resolve/promote`, MCP `board_post/list/resolve`, hook `mega hooks board`.

### Phase 3 — Q&A contract inside `@megasaver/mesh` + `mesh_send` kind routing
Ref: `docs/superpowers/specs/2026-08-06-peer-qa-routing-design.md:52`. `answerEvidenceSchema = chunk-set|file-line|none`, `answerPayloadSchema` requires `provenance {liveSessionId,evidence,answeredAtMs}`. `postAsk` guards `no_live_peers` + `ASK_MIN_INTERVAL_MS=60_000` persisted `ask-state/<senderId>.json`. Hint hook `mega hooks mesh-hint` opt-in `--mesh-hints`, keyword `≥3` overlap `≤200 events/30m` → `≤500 chars` hint.

### Phase 4 — Handoff capability + peers/offer
Ref: `docs/superpowers/specs/2026-08-06-cross-agent-handoff-design.md:58`. `HandoffCapabilityProfile {acceptsDiff,acceptsGitLine,maxBlockChars}` required on `ConnectorTarget` `packages/connectors/generic-cli/src/targets.ts:4`, evaluator `evaluateHandoffFit` measured on rendered block `renderHandoffBlockText`. `open` strict refuse (exit 1, nothing written) + `--fit` drop `diffText`→`gitLine`. `pack` advisory line, `mega handoff peers [--packet]` free, `mega handoff offer <file> --to-session` Pro gates on `hot-handoff` `packages/entitlement/src/entitlement.ts:1`.

## Error Handling

- Every hook entry: bounded stdin `256 KiB`, `catch-all → exit 0`, optional debug log under `store/mesh/debug/`, no stderr into agent.
- Corrupt JSON (presence/claim/board/cursor/ask-state) → `store/mesh/quarantine/` + recreate empty; `events.jsonl` skips torn lines; rotation is `rename + new file`.
- Staleness derived from persisted `lastSeenAt` (`stale >90s`, `dead >10m`), future skew → live; `file mtime` only for heartbeat debounce.
- Claims TTL `30m` default, expired removed by `gc()` (`5MB` / `7d` cap on `events.jsonl`, probabilistic `~1/50` invocations). `liveSessionId` is registry-issued, never agent-native reuse.

## Security & Privacy

- `redact()` `packages/policy/src/redact.ts:44` on all persisted user text (both CLI and MCP paths), including `offer` pointer fields; warn-only.
- Store `0600`/`0700`, repo-relative paths only (`scope` paths, chunk/file-line evidence), no network surface.
- Injection templates label all peer text untrusted (`session-mesh` rule); answers carry `evidence` pointers, not raw content; profiles never travel in packets/offers.
- Advisory-only: claims `warn-only`, board `advisory`, asks non-blocking, offers `pointer-only` — nothing auto-runs in a peer.

## Testing

- Unit per phase: schemas strict, staleness math, claim overlap/glob, board topic normalization + disputed/supersede matrix + TTL/injection budget, QA contract + rate-limit via injected `now()`, handoff fit table (strict vs `--fit`, `block_too_large`), redaction-before-write, quarantine, BoundedSet/rotation invariants.
- Integration per phase on temp store: two sessions → register→peers→send/drain→claim/conflict→board post→disputed→resolve→promote→ask→answer→hint→handoff `peers`/`offer`→`open` refuse/fit.
- CLI/hook tests per `workflows/cli-test-pattern.md` + `apps/cli/test/hooks/intent-run.test.ts` harness; no timing-tight assertions (injected clocks, wide windows).
- Hot-path guard: saver decision path adds no awaited mesh I/O (fire-and-forget heartbeat, debounced).
- Windows leg: polling path, rename semantics, no `fs.watch` on truth path.

## Risk & Process (HIGH)

Storage format + hot-path hooks + memory-gate adjacency ⇒ HIGH `concepts/risk-aware-development.md:1`. Chain per phase: this umbrella spec → architect pass (fresh context) → critic → worktree `feat/session-mesh-family` (Phase 1 worktree reuses) → TDD → `code-reviewer` AND `critic` separate passes (author≠reviewer) → `pnpm verify` 60/60 + `conventions:check` → verifier smoke (`mega mesh status`, two-session integration, hook fail-open).

## Dependencies / Build Order

1. **Phase 1 mesh** — no hard prereq except `shared`, `policy`, `daemon` plumbing. Enables 2-4.
2. **Phase 2 board** — hard prereq Phase 1 merge (`postEvent` seam, `gc()`). Enables high-confidence answer promotion.
3. **Phase 3 peer Q&A** — prereq Phase 1 (bus+inbox+`mesh_send`). No new store beyond `ask-state`.
4. **Phase 4 cross-agent handoff** — prereq `hot-handoff` i10 `feat/hot-handoff` on `main` + Phase 1 (presence/inbox). Owns the `handoff-offer` kind amendment.
Reuses: `encodeWorkspaceKey`, `familyKeyFromPath`, `redact`, `ensureStoreReady`, MCP registration `packages/mcp-bridge/src/server.ts:143`, hook install managed block `apps/cli/src/commands/hooks/*`.

## Open Questions (tracked, non-blocking)

1. Heartbeat debounce `5s` — tune after dogfood (Phase 1 OQ).
2. Board `BOARD_INJECT_MAX_TOKENS=500` + `30s` debounce — tune after dogfood.
3. QA hint `ASK_MIN_INTERVAL_MS=60s` and `≥3` keyword threshold — tune after dogfood.
4. Handoff `maxBlockChars` per target — `windsurf:6000` is placeholder pending vessel verification; `aider acceptsDiff:false` default may flip.
