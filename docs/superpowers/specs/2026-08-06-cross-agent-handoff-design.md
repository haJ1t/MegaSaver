---
feature: cross-agent-handoff
date: 2026-08-06
risk: HIGH
status: draft-design
pending: [user-spec-review, architect-pass, i10-chain-completion]
reviewers: [code-reviewer, critic]
build-order: "11 of 11 (next-wave batch; blocked by hot-handoff i10 shipping)"
---

# Cross-Agent Handoff (A4) — Delta over Hot Handoff i10

**DELTA SPEC.** Extends `docs/superpowers/specs/2026-07-18-hot-handoff-design.md` (i10).
Every i10 contract is inherited unchanged unless a Locked Decision below says otherwise.

## Problem

Hot handoff (i10) already moves a task packet between agents and writes the target agent's
config file — but it treats every target as identical: `renderHandoffBlockText` emits one
block shape for all seven `KNOWN_TARGETS`, and open's only target check is membership in
`KNOWN_TARGETS` (`apps/cli/src/commands/handoff/open.ts`). Agent context conventions
differ: rules files with hard size ceilings (windsurf `.windsurfrules`), frontmatter-gated
rule files (cursor `.mdc`), conventions-only files where a dirty diff excerpt is noise
(aider `CONVENTIONS.md`). And there is no discovery: the operator must know out-of-band
which live agent could receive the packet (pain P7,
`wiki/syntheses/vibe-coding-pains-2026.md`). Result: agent→agent handoff either
over-stuffs a target that silently cannot digest it, or never happens.

## Goal

`mega handoff` becomes capability-aware and mesh-discoverable: (a) each agent kind
declares, in its connector, what it can consume (per-agent-kind capability map); (b)
`open` translates the packet into the target's conventions through that declaration,
refusing **fail-closed with an explicit reason** when the target lacks a required
capability; (c) live receivable peers are discoverable via session-mesh presence, and a
handoff **OFFER (pointer, never payload)** can be dropped into a peer's mesh inbox.
Opening remains an explicit operator action.

## Non-Goals

- Cross-machine handoff. Offer pointers are machine-local paths; remote transport stays
  rejected (i10 §3 inherited).
- Auto-accept. No hook, inbox drain, or daemon ever runs `mega handoff open`; an offer
  only informs.
- Packet schema changes (LD1), new sentinel pairs, or changes to the locked block shape.
- Capability negotiation protocol — profiles are static code, not a runtime handshake.
- Auto-launching any agent; new memory stores; new sentinel blocks (i10 §3 inherited).

## Locked Decisions

**Inherited LOCKED contracts (extend, never duplicate or contradict):** the
`.megahandoff` two-line frame with `kind: "megahandoff"`, required `expiresAt`, and
fail-closed parse order (`packages/core/src/handoff-packet.ts`); the `MEGA SAVER:HANDOFF`
sentinel pair and `upsertHandoffBlockText` touching only that pair
(`packages/connectors/shared/src/{constants,upsert}.ts`); badges recomputed on
open/inspect, never traveling; the `"hot-handoff"` ProFeature key
(`packages/entitlement/src/entitlement.ts`).

Delta decisions:

1. **Packet untouched.** `HANDOFF_SCHEMA_VERSION` stays `"1"`; translation is entirely
   consume-side. `sourceAgent`/`targetAgent` (`agentSlugSchema`,
   `packages/core/src/handoff-packet.ts:26`) already identify the agent pair — no new
   packet fields, so core stays agent-agnostic (§1 mission).
2. **The capability map lives on `ConnectorTarget`.** The interface
   (`packages/connectors/generic-cli/src/targets.ts:4`) gains a **required**
   `handoff: HandoffCapabilityProfile` field. Profile type + Zod schema + fit evaluator
   live in `@megasaver/connectors-shared` (agent-agnostic mechanics); per-agent data lives
   with each target declaration (generic-cli's six targets + `CLAUDE_CODE_TARGET` in
   `apps/cli/src/known-targets.ts`). A required field makes "target without a profile"
   unrepresentable (pre-1.0 break; §13 no shims). Placement precedent: `AgentLauncher`
   (`packages/connectors/shared/src/launcher.ts`) — shared capability contract,
   per-connector adapters.
3. **Profile scope = exactly the variable surface of the block.** `HandoffBlockFields`
   (`packages/connectors/shared/src/handoff-block.ts`) varies only in `gitLine`/`diffText`
   nullability plus total size, so the profile is
   `{ acceptsDiff, acceptsGitLine, maxBlockChars: number | null }`. Resume, summary, and
   the expiry footer are mandatory for every target (locked block shape) and are not
   capability-controlled.
4. **Enforce at open, advise at pack.** `open` is the authoritative untrusted boundary:
   strict mode (default) refuses on any violation and writes nothing; `--fit` opts into
   deterministic lossy translation (drop `diffText` first, then `gitLine`; if the
   mandatory sections still exceed `maxBlockChars`, refuse even under `--fit`). `pack`
   never refuses (packets are portable); its report and `--dry-run` print the fit verdict
   for the chosen target.
5. **Discovery and offers ride the mesh, pointer-only.** Presence
   (`2026-08-06-session-mesh-design.md`) filters live peers whose agent kind maps to a
   `KNOWN_TARGETS` entry with a fitting profile. An offer is a mesh inbox message carrying
   `{ packetPath, payloadSha256, targetAgent, expiresAt, sourceProject }` — never packet
   content. `offer` re-runs `parseHandoffPacket` first: an unopenable (expired/tampered)
   packet is never advertised.
6. **Entitlement:** `offer` gates on the SAME `"hot-handoff"` key via the existing
   `gate()` helper (`apps/cli/src/commands/handoff/shared.ts`); `peers` is free
   (read-only, `inspect` precedent). No new ProFeature key.
7. **Refusals are data, not exceptions.** `evaluateHandoffFit` returns
   `{ ok: false, refusals: [{ reason, detail }] }` with the closed union
   `"section_diff" | "section_git" | "block_too_large"`; the CLI maps this to exit 1 plus
   a remedy line. Profiles never travel in packets or offers — a hostile packet cannot
   widen the receiving target's capabilities (badges-never-travel principle applied to
   capabilities).

## Architecture

```
pack (CLI, i10)                          offer (new)                 open (i10 + delta)
registry+git → buildHandoffPacket → .megahandoff ── pointer → mesh inbox → operator
                     │                     (never payload)                    │
        fit preflight (advisory, LD4)              parse fail-closed (i10 §4.3) → open-side
                                                   redaction (i10 §6.5) → evaluateHandoffFit
                                                   ok      → render → upsert → writeTargetFile
                                                   refused → exit 1, nothing written
```

Boundaries: core packages untouched. `connectors-shared` holds mechanics (schema +
evaluator); connector packages hold per-agent data; `apps/cli` aggregates and enforces.

## Components

1. **`packages/connectors/shared/src/handoff-capability.ts` (new).**
   `handoffCapabilityProfileSchema` / `HandoffCapabilityProfile`;
   `evaluateHandoffFit({ fields, profile, mode })` → `HandoffFitResult`. Size is measured
   on the rendered block (`renderHandoffBlockText(fields).length`) so the ceiling covers
   what actually lands in the file, sentinels + footer included.
2. **Target profiles.** `targets.ts`: codex/cursor/gemini/continue
   `{ acceptsDiff: true, acceptsGitLine: true, maxBlockChars: null }`; windsurf
   `{ …, maxBlockChars: 6000 }` (ASSUMPTION A1); aider
   `{ acceptsDiff: false, acceptsGitLine: true, maxBlockChars: null }` (conventions-file
   semantics; Aider derives its own diff context — OQ2). `CLAUDE_CODE_TARGET` (apps/cli):
   all-permissive. Module-load Zod validation beside `assertHeaderHasNoSentinels`.
3. **`open` delta** (`apps/cli/src/commands/handoff/open.ts`): after open-side redaction
   assembles the would-be `HandoffBlockFields` and BEFORE any write, run
   `evaluateHandoffFit` with the resolved `target.handoff`; strict/`--fit` per LD4.
   Refusal → exit 1, target file and store byte-unchanged (i10 §11.7 write-suppression
   table extended). `--fit` drops are reported on stdout and in `--json`.
4. **`pack` delta** (`pack.ts`): report and `--dry-run` gain one line —
   `fit(<target>): ok` or `fit(<target>): open will refuse (<reasons>) — receiver may
   pass --fit`.
5. **`mega handoff peers [--packet <file>] [--all] [--json]` (new, free).** Lists live
   mesh peers (repo-scoped by default: `listPeers` filtered on the cwd workspace key via
   `encodeWorkspaceKey`, mesh LD6; `--all` widens to every workspace) with session,
   agent, status; `--packet` adds each peer's fit verdict; agent kinds with no
   `KNOWN_TARGETS` entry list as `no target`.
6. **`mega handoff offer <file> --to-session <id> [--json]` (new, Pro).** `gate()` → size
   cap (`MAX_PACKET_BYTES`) → `parseHandoffPacket` fail-closed → strict fit pre-check
   against the packet's own `targetAgent` profile → mesh send with a `handoff-offer`
   message kind (ASSUMPTION A2) → advisory `appendHandoffEvent` with new additive
   `"offer"` kind member (`packages/stats/src/handoff-event.ts:16`).
7. **Receiver side: no new code.** The mesh drain (session-mesh components 2–3) surfaces
   the offer as labeled untrusted text advising `mega handoff inspect <path>` then `open`.
   Nothing auto-runs (Non-Goal 2).

## Error handling

- Capability refusal: exit 1, `error: <target> cannot consume this handoff: <details>` +
  one remedy line (`--fit`, or re-pack with a smaller `--budget`); nothing written.
- `--fit` insufficient (mandatory sections exceed the cap) → same refusal path, reason
  `block_too_large`.
- `offer`/`peers` with mesh unavailable → exit 1 `session mesh not initialized`; `offer`
  performs zero writes on any failure; no partial sends.
- `offer` to an unknown/dead session id → exit 1 via a presence pre-check (`listPeers`)
  before send — mesh `sendMessage` is fail-open (`MeshMessage | undefined`, creates
  inboxes on demand), so it cannot signal this itself; an `undefined` send result is a
  failure, never reported as success; no silent retry (§13). Expired/tampered packet →
  exit 1 with the `parseHandoffPacket` error (LD5). All i10 §10 behaviors inherited
  unchanged.

## Security & privacy

- i10 §9 posture inherited whole: both-direction redaction, render-time sentinel guard,
  atomic symlink-refusing writes, no transcripts, expiry fail-closed, badges recomputed
  locally, forgery-contained merge.
- Offers carry pointers, never content; the receiving `open` re-validates everything, so
  an offer confers zero trust.
- Profiles are code (LD7): no packet or offer field can widen a target's capabilities.
- Offer text passes mesh SECRET-REDACT before persist and is labeled untrusted on
  injection (session-mesh spec).
- Fail-closed direction preserved: unknown target, missing capability, unparseable
  packet, uninitialized mesh — all refuse; nothing degrades silently.

## Testing

- connectors-shared unit: profile schema; fit table — strict violation per section, size
  measured on the rendered block, fit drop order diff→gitLine, fit-still-over →
  `block_too_large`, all-permissive passthrough returns fields unchanged.
- generic-cli + apps/cli: every target carries a schema-valid profile; the required field
  keeps compile-time completeness (`known-targets.test-d.ts` precedent).
- CLI integration (`handoff-integration.test.ts` pattern): strict refusal asserts exit 1
  AND target file + store byte-unchanged; same packet with `--fit` writes the block
  without the diff and reports the drop; pack report prints the fit verdict.
- `offer`/`peers` unit with injected mesh functions (no daemon); expired packet never
  offered; `"offer"` event appended; pointer message contains no payload text.
- No timing-tight tests (CI-slowness lesson: structural guards only).

## Risk & process (§12 HIGH)

Connector core path + public CLI flags + writes into agent config files ⇒ HIGH. Chain:
this spec → user review → architect pass (fresh context) → writing-plans → worktree
`feat/cross-agent-handoff` → TDD → `pnpm verify` → `code-reviewer` AND `critic` separate
passes (author ≠ reviewer) → verifier evidence → changesets (`@megasaver/connectors-shared`,
`@megasaver/connector-generic-cli`, `@megasaver/cli`, `@megasaver/stats`) → wiki update.

## Dependencies / build order

- **Hard-blocked on hot-handoff i10 merging** (build-order 11 of 11): every touched
  surface (i10 §8 code map) must exist on `main` first.
- Capability + open/pack delta (plan Tasks 1–5) need ONLY i10. `peers`/`offer` (Tasks
  6–7) additionally need `@megasaver/mesh` (session-mesh, build 1 of 11) on disk. The
  mesh v1 kind union ships as exactly `message | ask | answer` (session-mesh plan,
  `meshMessageSchema`) with no `handoff-offer`; Tasks 6–7 therefore begin with an
  additive amendment to the mesh kind union plus an optional structured `offer` field
  (ASSUMPTION A2 — this feature owns that amendment; the mesh plan as written does not
  carry it).
- Enables: A6 peer Q&A (offer/answer pattern), GUI handoff panel (structured verdicts).

## Open questions

- OQ1 (A1): windsurf's exact rules-file ceiling — verify at implementation; 6000 assumed.
- OQ2: aider `acceptsDiff: false` default — flip if dogfood shows the diff excerpt helps.
- OQ3: `mega mesh status` handoff-receivable column vs `handoff peers` — mesh dogfood.

ASSUMPTIONS:

- **A1:** windsurf's `.windsurfrules` ~6000-char cap is product knowledge, not a repo
  symbol; the number is a placeholder pending OQ1.
- **A2:** the mesh message kind union (`message | ask | answer`, session-mesh spec
  component 1) accepts an additive `handoff-offer` member with a structured offer field;
  `@megasaver/mesh` does not exist on disk yet.
- **A3 (RESOLVED — verified, no longer an assumption):** mesh presence records are
  `presenceRecordSchema` (`docs/superpowers/plans/2026-08-06-session-mesh.md`,
  `packages/mesh/src/types.ts`, `.strict()`): `liveSessionId`, `agent`
  (`z.string().min(1).max(64)` — a free-form string, NOT a typed `AgentId`), `status`,
  `lastSeenAt`. `peers` matches `agent` against `ConnectorTarget.agentId` by plain
  string equality.
