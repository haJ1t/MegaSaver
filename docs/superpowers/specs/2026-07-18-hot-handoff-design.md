# Hot Handoff / Agent Passport (i10) — Design

- **Date:** 2026-07-18
- **Status:** user-approved design (4 scope decisions recorded 2026-07-18);
  3-lens adversarial spec verify applied same day (21 findings — 2
  BLOCKING, 10 MAJOR, 9 MINOR — all integrated: context-less
  `upsertHandoffBlockText`, render-time sentinel guard, badge recompute,
  payload-derived `inspect`, explicit `WarmStartInput`, `evaluatePathRead`
  path filtering incl. `changedFiles`, KNOWN_TARGETS resolution, dry-run
  gate semantics). User approved spec 2026-07-18. Architect pass (fresh
  context, xhigh) returned REVISE — B1 (deny.read globs require a threaded
  `permissions` object; spec's call shape provably didn't apply them),
  M1 (resolved session was never consumed; session-scoped memories now
  travel and merge forces `sessionId: null` + `scope: "project"`),
  M2 (open creates missing target file), M3 (open-side re-redaction),
  m1 (shared `bundle-frame.ts` instead of duplicated parse ordering),
  m2 (self-discounting expiry footer), m3 (`--merge` memories-only v1),
  m4 (§10 write-suppression test table), m5 (two-state upsert wording) —
  ALL integrated same day. Architect's own note: fixes fully enumerated,
  no second architect pass warranted beyond integration. Next gate:
  writing-plans. T13 restructured to subcommands-only (citty 0.1.6
  cannot mix root `run` + args + `subCommands`); surface is
  `mega handoff pack --to …`.
- **Risk:** HIGH (§12 — connector core path, public CLI flags, writes into
  target agent config files, secret-exfiltration surface). Architect design
  pass + code-reviewer AND critic (separate passes) required before merge.
  Worktree `feat/hot-handoff`; no `main` edits.
- **Portfolio:** i10 from `wiki/syntheses/memory-moat-portfolio.md` (27.7),
  ≈ N10 in `wiki/syntheses/post-2.0-growth-portfolio.md`. Release slice 2.2 in
  `wiki/syntheses/solo-developer-roadmap.md`. No pre-existing sketch (the
  sketches appendix covers i7/i8/i6/i1/i14/i21 only) — this spec is the
  first design artifact.
- **Scope decisions (user, 2026-07-18):**
  1. Architecture = `.megahandoff` bundle (brain-bundle sibling) with
     `mega handoff open` consumption; Warm-Start-extension and Brain-Sync
     transport rejected for v1.
  2. Gating = `--dry-run` FREE, real pack + open PRO under a new
     `"hot-handoff"` ProFeature key.
  3. Dirty working-tree diff IS included, filtered (secret-path exclusion →
     redaction → compression → token cap).
  4. Output = file always; `--copy` copies the packet *path* (never content)
     via `pbcopy`, darwin best-effort, silent skip elsewhere.

## 1. Problem

Live working context dies at the agent boundary. Switching Claude Code →
Codex (or laptop → desktop, branch → branch) forces the user to restate the
task, the half-done changes, the dead ends already burned, and the relevant
project knowledge. The Agent Experience Layer (2.2.0) made memory active,
truthful, and self-growing — but it is all anchored to one store consumed
in-place. Nothing carries *this task, right now* across agents or machines.

## 2. Goal and acceptance gate

`mega handoff pack --to codex` packs a redacted, bounded, expiring task packet;
`mega handoff open` applies it on the receiving side.

Acceptance (roadmap 2.2, verbatim gate):

1. Claude Code → Codex resumes a real task without the user restating it.
2. No secret and no raw transcript crosses the boundary.
3. No target agent is auto-launched.

Additional measurable evidence (DoD §5): captured terminal session of a real
pack → open → Codex-resume run; integration test asserting the `AGENTS.md`
block content; table-driven redaction/exclusion tests passing.

## 3. Non-goals (v1)

- **No MCP read tool** for target-side pull — explicit v2 (prevents review
  scope creep; `packages/mcp-bridge` stays untouched).
- **No remote transport.** Brain-Sync S3 carriage of packets contradicts the
  "no implicit remote sync" HIGH-risk mandate; deferred.
- **No cross-platform clipboard matrix** (wl-copy/xclip/clip.exe) — darwin
  `pbcopy` best-effort only, and only for the file path.
- **No automatic block cleanup daemon** — `mega handoff clear` is manual.
- **No auto-launch / process control** of any agent.
- **No new memory store.** All reads go through `CoreRegistry`; the packet is
  a projection, not a store.
- **Decision-trace-guided task summary** — the in-flight
  decision-trace-guided-summary feature is an integration point, not a
  dependency: when it ships, `taskSummary` can upgrade its source. v1 uses
  the Warm Start assembler.

## 4. Packet format — `.megahandoff`

Sibling of the brain bundle (`packages/core/src/brain-bundle.ts`), NOT an
extension: `brainManifestSchema` is `.strict()` with
`kind: z.literal("megabrain")`, so the handoff defines its own pair of
schemas with the same two-line discipline (manifest JSON line + payload JSON
line, `payloadSha256` = sha256 hex of the raw payload JSON string, one
trailing newline tolerated on parse, never written on serialize).

### 4.1 Manifest (`handoffManifestSchema`, strict)

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `"1"` literal | version gate before schema before hash |
| `kind` | `"megahandoff"` literal | |
| `sourceProject` | `{ name }` | identity by name, NEVER `rootPath` (cross-machine; `brain-import.ts:24` precedent) |
| `sourceAgent` | string | from `--from <id>`, default `"unknown"` (the CLI cannot detect its caller; resume text degrades to "another agent") |
| `targetAgent` | string | `"codex"`, `"claude-code"`, …; core schema keeps `z.string()` — the `KnownTargetId` enum lives in `apps/cli` and core must not import it; CLI validates at the boundary |
| `createdAt` | ISO string | |
| `expiresAt` | ISO string, **required** | default `createdAt + 24h`; `--expires <n>h\|<n>d` overrides (Zod-parsed at the CLI boundary) |
| `payloadSha256` | hex string | brain-bundle discipline |
| `redactionFindings` | number | summed detector count across all fields |
| `secretPathsExcluded` | number | unique paths excluded by the secret-path check (= `diff.excludedPaths.length`) |
| `counts` | `{ memories, failures, diffFiles, commits }` | |

### 4.2 Payload (`handoffPayloadSchema`)

- `taskSummary: { text, tokenEstimate }` — budgeted assembler output
  (§5 step 7).
- `resumeInstructions: string` — target-specific preamble ("You are resuming
  a task handed off from claude-code on project X…"). Rendered by the CLI
  from `targetAgent` and passed into `buildHandoffPacket` as a finished
  string; core treats it as an opaque redacted field (no agent-specific
  logic in core).
- `git: null | { branch, headSha, dirty, commits[], changedFiles[], diff }`
  where `diff: null | { text, truncated, excludedPaths[] }` — `text` is
  post-filter (§5 step 4). `changedFiles[]` and every porcelain-derived
  path list pass the SAME secret-path check as diff hunks (content
  protection without path protection would still disclose secret file
  locations). `null` = git unavailable (degraded, packet still valid).
- `failures: FailedAttempt[]` — unresolved only:
  `resolution === undefined && !convertedToRule` (the exact "unresolved"
  semantics established in `guard-match.ts` T1); every text field redacted.
- `memories: MemoryEntry[]` — see §5 step 5. **No badge field travels in the
  payload**: a packet-supplied badge would let a hostile packet forge the
  "verified" trust signal. `verificationBadgeFor` is deterministic over
  `MemoryEntry`, so the receiving side recomputes badges locally wherever
  they are displayed (`inspect`, `--merge` report).

### 4.3 Parse (`parseHandoffPacket`)

Order: manifest JSON → `schemaVersion` check → strict schema → payload hash
compare → payload schema → **expiry check, fail-closed** (the
`packages/entitlement/src/license.ts` `exp` model: checked on every open, an
expired packet is rejected, never partially applied). Typed
`HandoffPacketError` codes: `malformed | hash_mismatch |
unsupported_version | expired`.

The packet file is an external boundary per the parse-on-handoff policy
(`docs/conventions/code-conventions.md`): full Zod + hash validation on
open; registry-validated data is NOT re-parsed at pack time.

## 5. Pack pipeline — `mega handoff pack --to <target>`

Command shape clones `runBrainExport` (`apps/cli/src/commands/brain/export.ts`):
pure `runHandoff(input): Promise<0|1>` with injected
`{ storeRoot, now, stdout, stderr, publicKey?, execGit?, ensureStore }`.

1. **Gate first.** `checkEntitlement("hot-handoff")` (new `ProFeature` union
   member, `packages/entitlement/src/entitlement.ts`) BEFORE `ensureStore`
   and before any lazy `@megasaver/core` import. Precise semantics:
   unentitled AND not `--dry-run` = upsell on stdout, exit 0, zero work,
   zero writes. `--dry-run` (free surface, autopilot precedent) runs the
   read-only pipeline regardless of entitlement — store reads and git exec
   happen, nothing is ever written — and prints what WOULD be packed:
   counts, redaction findings, excluded paths.
2. **Resolve.** `findProjectByCwd` (exported from
   `apps/cli/src/commands/warmup.ts`). Session rule: latest open session
   across ALL agents; `--from` is manifest metadata only, never a session
   filter (`pickLatestOpenSession`'s agentId filtering does not apply
   here). The resolved session is CONSUMED in step 5: recallable
   session-scoped memories with `sessionId === resolved session's id` join
   the packet (this is the "this task, right now" content the feature
   exists for). No open session → pack proceeds with project-scoped
   content only; the report notes "no open session".
3. **Git state.** `gatherGitDelta` (`apps/cli/src/git-delta.ts`, as-is) for
   branch/commits/changed-files, plus NEW `gatherDirtyState` in the same
   file, same injectable `ExecGit` convention (`execFileSync`, 3000 ms
   timeout, 10 MB maxBuffer, throw-safe → `null`): full-repo
   `git status --porcelain` + `git diff` + `git diff --cached`, and
   `rev-parse HEAD` for `headSha` (GitDelta today carries neither dirty
   state nor HEAD — confirmed gap). Git failure degrades: `git: null`,
   noted in the report, never fatal.
4. **Diff + path filter (ordered, all steps mandatory):**
   a. split the patch into per-file hunks;
   b. load `ProjectPermissions` ONCE per pack from the packing project's
      root via `loadProjectPermissions`
      (`packages/context-gate/src/load-project-permissions.ts`; the CLI
      loads it and threads it into the pure `buildHandoffPacket` —
      injected-deps command shape). A present-but-malformed
      `permissions.yaml` ABORTS the pack, fail-closed (context-gate
      `run.ts` I3 precedent). Then drop every hunk whose path fails
      `evaluatePathRead({ path, project, permissions })` — the
      `permissions` object MUST be passed on every call: the LOCKED
      secret-path denylist is internal, but the project's `deny.read`
      globs apply ONLY via the threaded `permissions` object (the
      `project` field is a vestigial label the function never reads —
      `context-gate/src/read.ts:122`). Count unique excluded paths into
      `secretPathsExcluded`, list into `diff.excludedPaths`. Rationale: a
      committed `.env` hunk defeats the 17 regex detectors; the path
      denylist + user deny globs are the reliable signal.
      `SECRET_PATH_PATTERNS` itself is not on policy's public surface and
      is not imported directly;
   c. apply the same `evaluatePathRead` check (same `permissions` object)
      to `changedFiles[]` and every porcelain-derived path list — an
      excluded path appears nowhere in the packet (existence disclosure is
      a leak too);
   d. `redactWithFindings` over the surviving text;
   e. `compressDiff` (`packages/output-filter/src/compress/diff.ts`);
   f. token cap via `estimateTokens`; on overflow truncate whole trailing
      hunks, set `diff.truncated`.
5. **Memories.** `listMemoryEntries(projectId)` →
   `isRecallable(m, now) && !stale`, PLUS recallable session-scoped
   entries whose `sessionId` equals the step-2 resolved session (project
   and session entries compete in the same ranking), ranked by
   `effectiveConfidence`, cap 20 (the `buildConnectorContext` cap). Badges via `verificationBadgeFor`
   **hoisted from `packages/mcp-bridge` to
   `packages/core/src/verification-badge.ts`** (it depends only on
   `MemoryEntry`; mcp-bridge re-imports from core — no behavior change) —
   computed for the pack report and `--dry-run` display ONLY; badges never
   enter the payload (§4.2). Badge wording stays stored-state honest:
   "verified" means anchored with no stored contradiction, never a live
   check. Entries are re-read fresh at pack time (concurrent recall may
   have just flipped contradiction state).
6. **Failures.** Filter per §4.2; cap 10, most recent first.
7. **Task summary.** `assembleWarmStartBrief` (pure, no-I/O) with an
   EXPLICIT `WarmStartInput`: `mode: "standard"`, `timeless: true`,
   `reonboardUnlocked: true` (pack is already Pro-gated). Never let
   `selectWarmStartMode` auto-pick: a handoff is packed minutes after
   working, `lastSeenAt < 4h` would silently collapse the summary to a
   300-token micro stub and ignore `--budget`. `timeless: true` drops the
   brief's git/absence/entities sections — the packet carries git state
   itself (§4.2), one source per content type. Default budget
   `DEFAULT_WARM_START_BUDGET` (2000), `--budget` validated to [300, 8000]
   (warmup precedent).
8. **Redaction accumulator.** Clone the `makeRedactor` closure
   (`packages/core/src/brain-export.ts`): every free-text field of every
   section passes through `redactWithFindings`; totals land in
   `manifest.redactionFindings`. Fields destined for sentinel blocks
   additionally pass `containsSentinel` (NFKC + zero-width-strip guard).
9. **Write.** `serializeHandoffPacket` → atomic tmp + rename (brain export
   pattern), default filename `<project>-<YYYYMMDD-HHmm>.megahandoff`,
   `--out` overrides. `--json` report; `--copy` per scope decision 4.
10. **Event.** Advisory `appendHandoffEvent` (§8) wrapped in try/catch —
    never fails the pack.

Structural guarantee for gate item 2: the packer reads ONLY the registry
and git — session transcripts are never opened, so "no raw transcript"
holds by construction, not by filtering.

## 6. Consume pipeline — `mega handoff open <file>`

1. Gate: `checkEntitlement("hot-handoff")` (same key; offline Ed25519
   license works across the user's machines) — first, before any file or
   store IO, per the uniform gate-before-work invariant.
2. **Resolve destination.** Receiving project root = `findProjectByCwd`
   project root. `open` REQUIRES the cwd to be inside a registered
   Mega Saver project — outside one it exits 1 pointing at `mega init`
   (HIGH-risk posture: never write agent config files in unregistered
   directories). `--merge` writes into the RECEIVING cwd project's store
   (`sourceProject.name` identifies the sender only). Target surface
   resolved via the apps/cli aggregate: `KNOWN_TARGETS` /
   `isKnownTargetId` (`apps/cli/src/known-targets.ts` — spans codex AND
   claude-code; generic-cli's `findTarget` does NOT know claude-code and is
   not used here). Unrecognized `packet.targetAgent` (external-boundary
   `z.string()`) → exit 1 with an `invalidTargetMessage`-style error,
   nothing written. Target file path = project root +
   `target.relativePath`.
3. `statSync` size cap **10 MB** before read (brain-import's 100 MB is for
   whole-brain bundles; a task packet an order of magnitude smaller).
4. `parseHandoffPacket` — hash + expiry fail-closed (§4.3).
5. **Block write.** Render `renderHandoffBlockText` (new,
   `packages/connectors/shared/src/handoff-block.ts`). Single source per
   content type — no double rendering:
   - resume instructions (packet field);
   - task summary = the brief text (already contains rules, decisions,
     todos, do-not-retry failures);
   - working-tree diff excerpt (`git.diff` — the only content the brief
     does not carry) + branch/headSha/dirty line;
   - footer as a self-discounting INSTRUCTION, not a bare date (expiry is
     fail-closed on open only; once applied the block would otherwise feed
     the agent forever): `Expires: <iso> — if the current date is past
     this, disregard this handoff and suggest \`mega handoff clear\`.`
   Structured `memories[]` exist in the payload for `--merge` and
   `inspect`; structured `failures[]` are for `inspect` ONLY in v1
   (`--merge` does not import failures — see step 6). Neither is
   re-rendered in the block (the brief covers them).
   **Missing target file:** the packet's `targetAgent` is an explicit
   target, so open CREATES the file when absent (fresh machine / fresh
   clone is the primary cross-machine case): mkdir the dirname, write a
   file containing only the HANDOFF block, seeding the target's `header`
   frontmatter first if the `ConnectorTarget` defines one (cursor
   frontmatter contract, conventions §7). Warmup's "'all' never creates"
   rule applies only to implicit target fans, not here.
   **Open-side redaction (untrusted path, same principle as the sentinel
   guard):** before rendering, run `redactWithFindings` over every
   interpolated field — a hostile, tampered, or older-weaker-redaction
   packet must not persist raw secrets into a user file that routinely
   gets committed. Write the redacted text; warn in the open report when
   findings > 0 (a legitimately packed packet reports 0, happy path
   unchanged).
   **Render-time sentinel guard (mandatory):** `renderHandoffBlockText`
   runs `containsSentinel` over EVERY field it interpolates (resume text,
   summary, diff text — multi-line and schema-unconstrained, so a bare
   sentinel line inside it is otherwise possible) and throws before any
   write. Pack-time guarding (§5 step 8) never executes on a hostile
   packet's path; the open side re-guards from untrusted data.
   Write path — context-less by design:
   - NEW fourth sentinel pair `MEGA SAVER:HANDOFF BEGIN/END` added to
     `packages/connectors/shared/src/constants.ts` AND registered in
     `ALL_SENTINELS` (`sentinel-guard.ts`);
   - NEW standalone `upsertHandoffBlockText(existingContent, block)`
     following the `upsertContextGateBlockText` precedent (upsert.ts:82 —
     it exists precisely because the GUI path has no `ConnectorContext`).
     Two-state like its precedent (`""` = remove, text = upsert;
     "untouched" is expressed by not calling it). It touches ONLY the
     HANDOFF sentinel pair and leaves the legacy + CG + WS blocks
     byte-identical. The full `upsertBlock`
     (which requires a `ConnectorContext` and unconditionally re-renders
     the other managed blocks) is NOT used by open/clear;
   - `projectionPreflight` extended with one more `parseBlock` call for the
     new pair;
   - file IO exclusively through `writeTargetFile` (atomic temp+rename,
     symlink-refusing) — the HIGH-risk destination-write property.
6. **Memory merge — opt-in `--merge`, memories ONLY in v1** (failures are
   inspect-only; no failure import). Clone of `importBrain` safeguards
   (`packages/core/src/brain-import.ts`), all load-bearing: remint ids,
   force `approval: "suggested"`, force `sessionId: null` and
   `scope: "project"` (session-scoped packet entries land project-scoped
   on the receiving side — `brain-import.ts:54-56` precedent), provenance
   evidence `handoff:<sourceProject.name>`, `stripReservedKeywords`
   (blocks forged `from-session:` ledger keywords), content-keyed dedupe,
   merge-only, idempotent. Badges shown in the merge report are recomputed
   locally (§4.2). Default open = block only.
7. **`mega handoff clear [--target <id>]`** — removes the HANDOFF block via
   `upsertHandoffBlockText(existing, "")`. No `--target` = clear the block
   from every `KNOWN_TARGETS` file present in the project root (warmup
   all-targets precedent). Runs WITHOUT entitlement: removing injected
   content is never gated.
8. **`mega handoff inspect <file>`** — free, applies nothing, and must work
   on the packets a skeptic most wants to examine: it runs the same checks
   as `parseHandoffPacket` but REPORTS failures (hash mismatch, expired,
   version) as status lines instead of refusing. The report is derived
   from the PAYLOAD, not from manifest self-claims: inspect re-runs the
   redaction/secret-path scan over payload text and prints real findings
   plus the payload's free-text sections, with a warning when recomputed
   numbers disagree with the manifest (`redactionFindings`,
   `secretPathsExcluded`, `counts` are attacker-writable; echoing them
   verbatim would let a hostile packet claim "0 secrets" while carrying
   raw keys). Badges displayed are recomputed locally.
9. No process is started; the target agent picks the block up on its own
   next session (gate item 3).

## 7. CLI surface

```
mega handoff pack --to <target> [--from <id>] [--out <file>] [--expires <n>h|<n>d]
                  [--budget <n>] [--dry-run] [--copy] [--json]
                                               # pack (Pro; --dry-run free)
mega handoff open <file> [--merge] [--json]    # apply block (+ merge) (Pro)
mega handoff inspect <file> [--json]           # manifest + redaction report (free)
mega handoff clear [--target <id>]             # remove block (free, ungated)
```

Registration: `apps/cli/src/commands/handoff/index.ts` (+ `pack.ts`,
`open.ts`, `inspect.ts`, `clear.ts`, `shared.ts` for the gate helper per the
brain-sync `common.ts` precedent) and two edits in `apps/cli/src/main.ts`.
`--to` validated by `isKnownTargetId`; invalid → `invalidTargetMessage`
(`errors.ts`). Upsell constant `HANDOFF_UPSELL` referencing
`PRO_ANALYTICS_URL` (savings/shared precedent). Unentitled = upsell +
exit 0, uniform with every gated command.

## 8. New code map

| File | Content |
|---|---|
| `packages/core/src/bundle-frame.ts` | NEW shared parametrized two-line-bundle frame (kind literal, version const, manifest/payload schemas, error class in; parse/serialize + version→schema→hash ordering out) — extracted from `brain-bundle.ts`, consumed by BOTH brain-bundle and handoff-packet so the security-relevant parse ordering has one copy (`5f8bbdb8` shared-helper precedent); brain-bundle's public surface unchanged |
| `packages/core/src/handoff-packet.ts` | handoff schemas over the shared frame + expiry check after the frame returns, `serializeHandoffPacket`, `parseHandoffPacket`, `HandoffPacketError`, `HANDOFF_SCHEMA_VERSION` |
| `packages/core/src/handoff-export.ts` | pure `buildHandoffPacket` (registry data + git state + now + pre-rendered `resumeInstructions` string in, packet out — target-to-text rendering stays in the CLI), redaction accumulator, diff hunk filter |
| `packages/core/src/handoff-import.ts` | `applyHandoffMemories` suggested-gate merge |
| `packages/core/src/verification-badge.ts` | hoisted `verificationBadgeFor`; mcp-bridge re-imports |
| `apps/cli/src/git-delta.ts` | + `gatherDirtyState` (same `ExecGit`) |
| `packages/connectors/shared/src/{constants,sentinel-guard,upsert,preflight}.ts` | fourth sentinel pair; standalone `upsertHandoffBlockText` (context-less, `upsertContextGateBlockText` precedent); preflight wiring |
| `packages/connectors/shared/src/handoff-block.ts` | `renderHandoffBlockText` with render-time `containsSentinel` guard on every interpolated field |
| `apps/cli/src/commands/handoff/*`, `apps/cli/src/main.ts` | command family |
| `packages/entitlement/src/entitlement.ts` | `ProFeature` + `"hot-handoff"` (plain source edit; normal `pnpm build`) |
| `packages/stats/src/handoff-event.ts` | strict-Zod `HandoffEvent` (`kind: "pack" \| "open"`, counts, redactionFindings, target), advisory JSONL append; re-export via the core `context-gate.ts` block |

Dependency direction unchanged: CLI resolves entitlement and threads
results; `@megasaver/entitlement` never enters core or mcp-bridge; no
agent-specific logic in core (target rendering lives in connectors/CLI).

## 9. Security posture (HIGH)

- **Redaction-first, BOTH directions:** no field enters the packet
  un-redacted at pack time, and open re-redacts every interpolated field
  before writing into the user's config file (hostile/tampered packets
  never persist raw secrets); counts are disclosed in the manifest, by
  `inspect`, and in the open report.
- **User deny globs honored:** `ProjectPermissions` loaded once per pack
  and threaded into every `evaluatePathRead` call; malformed
  `permissions.yaml` aborts fail-closed.
- **Secret-path exclusion** on diff hunks — regex detectors alone are
  insufficient for committed secret files (design-time finding).
- **No transcripts read** — structural, not filtered (§5).
- **Explicit expiry, fail-closed** on every open (§4.3).
- **Sentinel injection guard at RENDER time on open** (untrusted-path
  guard; pack-time guarding alone never executes on a hostile packet) over
  every interpolated field; new pair registered in `ALL_SENTINELS`.
- **Trust signals never travel:** badges are recomputed locally on the
  receiving side; a packet cannot assert "verified". `inspect` recomputes
  redaction/secret scans over the payload instead of echoing
  attacker-writable manifest counts.
- **Atomic, symlink-refusing writes** for both packet file and target
  config file.
- **Forgery containment on merge:** suggested-gate + `stripReservedKeywords`
  + reminted ids — a hostile packet cannot self-approve memories or forge
  ledger keywords.
- **No network, no auto-launch, no daemon.**
- Packet identity by project *name*; `rootPath` never travels.

## 10. Error handling

- `HandoffPacketError` codes mapped through `mapErrorToCliMessage`
  (exit 1, one-line message; `expired` says when it expired).
- Git unavailable → degraded packet (`git: null`), report notes it, exit 0.
- No open session at pack time → proceed project-scoped, report notes it,
  exit 0.
- Unrecognized `packet.targetAgent` on open → exit 1,
  `invalidTargetMessage`-style error, nothing written.
- `open` outside a registered project → exit 1 pointing at `mega init`,
  nothing written.
- Oversized packet file on open → refuse before read.
- Target file with corrupted sentinels → `parseBlock` `block_conflict`
  propagates as exit 1 (existing connector behavior, not silently repaired).
- Stats append failures swallowed (advisory).

## 11. Testing (TDD, per module)

1. `handoff-packet`: round-trip; tampered payload → `hash_mismatch`;
   future `schemaVersion` → `unsupported_version`; past `expiresAt` →
   `expired`; trailing-newline tolerance.
2. `handoff-export`: table-driven — redaction counts sum correctly;
   secret-path table incl. adversarial rows (`.env` hunk, `**/secrets/**`,
   `id_rsa`); a path denied ONLY by a project `deny.read` glob is excluded
   from hunks AND `changedFiles[]` (permissions threading); malformed
   `permissions.yaml` aborts the pack; a denylisted path present in
   `changedFiles[]` is dropped there too; session-scoped memories of the
   resolved session included, other sessions' excluded; caps (20 memories
   / 10 failures / diff truncation flag); unresolved-failure filter;
   degraded-git packet; no badge field in the serialized payload.
3. `gatherDirtyState`: injected `ExecGit` fixtures — dirty/clean/no-repo.
4. Connectors: `upsertHandoffBlockText` tri-state; other managed blocks
   byte-identical after a handoff upsert/remove; preflight with all four
   pairs; CRLF round-trip (dominant-EOL); ADVERSARIAL: bare sentinel line
   embedded in `git.diff.text` and in a multi-line failure field →
   `renderHandoffBlockText` throws, nothing written.
5. CLI: `runHandoff`/`runHandoffOpen` with injected deps + `signTestLicense`
   (deliberate per-file duplication convention); gate-before-store ordering
   asserted (unentitled non-`--dry-run` run performs zero store IO;
   `--dry-run` performs reads but zero writes); `clear` works unlicensed
   and defaults to all present targets.
6. Integration: pack in fixture project A → open in fixture project B →
   assert `AGENTS.md` block content, expiry-instruction footer, `--merge`
   produces `suggested` entries with provenance, `sessionId: null`,
   `scope: "project"`, and locally recomputed badges; open into a project
   with NO pre-existing target file creates it (header seeded when the
   target defines one).
   HOSTILE-PACKET rows: forged manifest counts (raw key in payload,
   `redactionFindings: 12` claimed) → `inspect` recomputes and warns;
   raw key in payload text → `open` writes the REDACTED form and warns
   (open-side redaction); packet-supplied badge ignored (schema rejects a
   `badge` field); expired packet → `open` refuses, `inspect` still
   reports.
7. §10 write-suppression table (one table-driven CLI block, each row
   asserting exit code AND target file + store byte-unchanged): open
   outside a registered project; unrecognized `packet.targetAgent`;
   oversized packet; corrupted sentinels (`block_conflict`).
8. Smoke (DoD evidence): real-repo pack → open → captured session.

## 12. Process

Chain per §4/§12: this spec (architect pass pending) → writing-plans →
worktree `feat/hot-handoff` → TDD → `pnpm verify` → code-reviewer AND
critic (separate passes, author ≠ reviewer) → verifier evidence → changeset
(`@megasaver/core`, `@megasaver/cli`, `@megasaver/connectors-shared`,
`@megasaver/connector-generic-cli`, `@megasaver/entitlement`,
`@megasaver/stats`) → wiki update (`entities/` page + portfolio status +
log) on completion.
