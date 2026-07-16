# Brain Autopilot (i14) — Design

- **Date:** 2026-07-14
- **Status:** architect pass applied (verdict APPROVE-WITH-FIXES; B1 + M2–M5 +
  m6–m10 integrated, 2026-07-14)
- **Risk:** HIGH (§12 — memory write path: a machine writes `approved` rows).
  Architect pass on this spec + full gauntlet (code-reviewer AND critic)
  required before merge.
- **Portfolio:** i14 from `wiki/syntheses/memory-moat-portfolio.md` (28.3).
  Sketch: `wiki/syntheses/memory-moat-sketches.md` §i14.
- **Base branch:** `feat/brain-autopilot` from `origin/main` (post i8/i7/i1/i6
  merges, eb74c352).
- **Scope decision (user, 2026-07-14):** v1 = engine + digest, NO
  auto-triggers (SessionEnd hook / daemon RPC deferred to their own spec),
  NO GUI (deferred). Gating: new `"brain-autopilot"` ProFeature key; FREE =
  `run --dry-run` + existing review/approve/reject/from-session; PRO = real
  auto-approve (`run`) + `mega brain digest`.

## 1. Problem

Approval rot (baseline weakness #3): agent writes default to
`approval: "suggested"` and sit invisible. Every shipped feature now FEEDS
this queue — guard outcomes write `FailedAttempt` source rows, warm start reads
only approved rows, `save_memory` (i1) deliberately defers closes to human
approval, code-truth anchors accumulate on suggested rows too. The queue
fills faster with each feature; nothing drains it.

## 2. Goal

The brain grows itself, safely, with a fast human backstop:

1. **Capture** — `runAutopilot` distills a session's recorded failures into
   memory candidates (reusing the existing extractor verbatim).
2. **Auto-approve the safe slice** — allowlisted types, high confidence
   (deterministic repeat-failure rule, no LLM), per-session cap, full
   provenance, always reversible.
3. **Triage the rest in seconds** — `mega brain digest`: a single-keystroke
   y/n/e/s/u/q loop over ALL pending suggested rows (not just autopilot's),
   so the existing backlog drains through the same door.

**The whole trick: zero MemoryEntry schema change.** The digest queue IS
`approval === "suggested"`. Autopilot makes the existing backlog the product
surface instead of adding a new table.

## 3. Grounding (verified on origin/main @ eb74c352)

| Fact | Location |
|---|---|
| `extractSessionMemories(input)` — pure, no-LLM, distills `FailedAttempt` rows into `ExtractedCandidate[]`; **collapses identical candidates within a session by `contentHash`** ("N identical failures collapse to 1") | `packages/core/src/session-memory.ts:102-117` |
| `ExtractedCandidate = { type, source, scope:"session", confidence ("low" default, "medium" test-shaped), approval:"suggested", title, content, relatedFiles, contentHash (16-hex over type+title+content), dedupeKey (sourceFailureId:contentHash) }` | `session-memory.ts:9-24` |
| `from-session` stages candidates as suggested rows with keyword `from-session:<dedupeKey>` as the ONLY dedupe on this path (deliberately `detect:false` — architect #5, i1) | `apps/cli/src/commands/memory/from-session.ts:29-135` |
| `runMemoryApprove` / `defineApprovalCommand("approve"\|"reject")` — the approval flip goes through `registry.updateMemoryEntry`; i1 made the flip decay-safe (`lastActiveAt` keying — approve does NOT reset age); the `approved` branch runs `applySupersession` (declared-target close); `RunMemoryApproveInput.approval` admits only `"approved" \| "rejected"` today (digest's undo/revoke needs the §6.2 widening) | `apps/cli/src/commands/memory/approve.ts:8-70`, `registry.ts:373` |
| Atomic single-JSON store sibling pattern (mkdir + tmp write + rename) | `packages/core/src/guard-state.ts`, `embed-memory.ts:40-54` |
| `ProFeature = "savings-analytics" \| "brain-portability" \| "code-truth"`; `checkEntitlement` fail-closed, feature-agnostic; gate-first + upsell-print pattern | `packages/entitlement/src/entitlement.ts:6,37` |
| `brainCommand` subcommand tree (export/import/sync) — autopilot + digest slot in here | `apps/cli/src/commands/brain/index.ts` |
| Recall predicate `isRecallable` = approved + current + non-archival — suggested rows are invisible to agents until approved | `packages/core/src/memory-entry.ts:176-185` |
| Extraction inputs today are failures only → candidates carry type `"test_behavior"` (test-shaped) or `"bug"` (generic), plus `"decision"` when an explicit `DECISION:` marker exists. **The extractor NEVER emits type `"failed_attempt"`** — `FailedAttempt` is the SOURCE row, not a candidate type (architect B1) | `session-memory.ts:72` (`type: isTest ? "test_behavior" : "bug"`), `:80-88`; corroborated by `packages/core/test/session-memory.test.ts:74` |
| `DEDUPE_KEYWORD_PREFIX` is NOT exported today — a local const duplicated in from-session.ts:32 AND mcp-bridge from-session-memory.ts:27 (architect m6: must be promoted to a shared core export) | both files |
| from-session also captures a git code anchor per candidate (`captureCodeAnchor` over relatedFiles) — "reuse from-session exactly" includes the anchor (architect m7) | `from-session.ts:105-113` |

## 4. Data model

**No MemoryEntry schema change.** Two new store-root JSON files + one
additive field on an internal type.

### 4.1 `autopilot.json` (store root, atomic tmp+rename, guard-state.ts pattern)

```ts
export const autopilotPolicySchema = z.object({
  enabled: z.boolean(),
  autoApproveTypes: z.array(memoryTypeSchema),
  autoApproveMinConfidence: z.literal("high"),
  maxAutoApprovesPerSession: z.number().int().positive(),
}).strict();

export const DEFAULT_AUTOPILOT_POLICY: AutopilotPolicy = {
  enabled: false,
  autoApproveTypes: ["bug", "test_behavior"],
  autoApproveMinConfidence: "high",
  maxAutoApprovesPerSession: 10,
};
```

- Global (no per-project overrides in v1).
- **Default `autoApproveTypes = ["bug", "test_behavior"]`** (architect B1:
  these are the two types the extractor actually emits from failures —
  `failed_attempt` is the SOURCE row kind, never a candidate type; the
  sketch and the first spec draft conflated them, which would have made
  auto-approve permanently inert). `decision` is deliberately NOT
  defaulted — human-stated decisions deserve human approval.
- Missing/corrupt file ⇒ `DEFAULT_AUTOPILOT_POLICY` (fail-closed to
  disabled; a corrupt policy never silently enables auto-approval).

### 4.2 `digest-state.json` (store root, same pattern)

```ts
export const digestStateSchema = z.object({
  lastDigestAt: z.string().datetime({ offset: true }).nullable(),
}).strict();
```

Drives the digest header ("since <lastDigestAt>") only. `lastSessionSeen`
DROPPED from v1 (architect m8 — no reader until the nudge/trigger wave;
`.strict()` makes re-adding it there a clean additive change). v1 has no
nudge.

### 4.3 `ExtractedCandidate.occurrences` (additive, core-internal type)

The extractor collapses identical failures by `contentHash`, so the repeat
signal the scoring rule needs is lost by the time candidates exist. Add
`occurrences: number` to `ExtractedCandidate` (count of source rows collapsed
into this candidate). The collapse loop already detects duplicates
(`seen.has(contentHash)`) — counting is a ~3-line additive change to
`session-memory.ts`. Not a Zod schema; existing consumers (`from-session`)
ignore the extra field. Existing tests must stay green.

## 5. Core: `packages/core/src/autopilot.ts` (NEW)

### 5.1 `scoreCandidate` (pure)

```ts
export function scoreCandidate(
  candidate: ExtractedCandidate,
  signals: { priorSessionHit: boolean },
): MemoryConfidence;
```

Deterministic rule table, no LLM:

| Rule id | Condition | Result |
|---|---|---|
| `recurring-failure` | `(type === "bug" \|\| type === "test_behavior")` AND `signals.priorSessionHit` | `"high"` |
| `keep-extractor` | everything else | `candidate.confidence` (extractor's low/medium) |

**Dampener (architect M2 — non-negotiable):** within-session repetition
alone NEVER auto-approves. The guard-outcome loop and `task step
--record-failure` write `FailedAttempt` rows automatically, so a stuck retry
storm trivially produces `occurrences >= 2` in one session — that is a
signal an automated loop got stuck, not that the memory matters.
`priorSessionHit` is true only when the candidate's `contentHash` also
appears among the candidates extracted from a DIFFERENT, EARLIER session's
failures in the same project (recomputed with the same pure
`extractSessionMemories` — cheap, deterministic). Cross-session recurrence
is the importance signal; single-session storms stay `suggested` and drain
through the digest. **This dampener is a hard precondition for the wave-2
auto-trigger spec** — automation without it weaponizes occurrence inflation.

`occurrences` (within-session collapse count) is kept as a DISPLAY signal
(digest renders "seen N× this session"), not a scoring input.

The rule id is recorded in provenance evidence. Adding rules later = new
table rows; the function stays pure and trivially TDD-able.

### 5.2 `runAutopilot` (the engine)

```ts
export function runAutopilot(opts: {
  registry: CoreRegistry;
  projectId: ProjectId;
  sessionId: SessionId;
  policy: AutopilotPolicy;
  now: string;
  newId: () => string;
  dryRun?: boolean;
}): AutopilotRunResult;

export type AutopilotRunResult = {
  autoApproved: MemoryEntry[];   // dryRun: the would-approve set (not persisted)
  staged: MemoryEntry[];         // dryRun: the would-stage set (not persisted)
  skippedExisting: number;       // dedupe hits (already staged in a prior run)
  cappedOut: number;             // would-have-approved beyond the session cap
};
```

Algorithm:

1. `extractSessionMemories` **verbatim** over the session's failures
   (`listFailedAttempts` pre-filtered to `sessionId`) — same candidates,
   same dedupe. Ordering assumption (architect m10): candidate order derives
   from `listFailedAttempts` input order, which is append-only/stable — the
   collapse keeps the FIRST failure's id in `dedupeKey`, so a reordering
   store would break idempotence. The idempotence test pins this (add a new
   failure, re-run, assert no duplicate of the old rows).
2. Cross-run idempotence: skip any candidate whose
   `from-session:<dedupeKey>` keyword already exists on the project
   (EXACTLY the from-session mechanism, same keyword prefix — so autopilot
   then manual `from-session` is a no-op and vice versa).
3. Dampener signal: extract candidates from the project's OTHER (earlier)
   sessions' failures with the same pure extractor; `priorSessionHit` =
   current candidate's `contentHash` present in that set. Then score via
   `scoreCandidate(candidate, { priorSessionHit })`.
4. Split (in candidate order, deterministic). BOTH branches write
   `keywords: ["from-session:<dedupeKey>"]` (architect M4 — the keyword IS
   the idempotence ledger; approved rows without it would duplicate on
   every re-run) and capture the same git code anchor from-session captures
   (`captureCodeAnchor` over relatedFiles, architect m7):
   - `type ∈ policy.autoApproveTypes` AND score `=== "high"` AND
     auto-approve count `< maxAutoApprovesPerSession` →
     `approval: "approved"`, `confidence: "high"`,
     `validFrom: now` (first automatic writer of the M1 bi-temporal field),
     `lastActiveAt: now`, evidence
     `"autopilot@1 rule=recurring-failure session=<sessionId>"`.
   - everything else (wrong type, low score, over cap) →
     `approval: "suggested"`, extractor confidence, no autopilot evidence —
     the same row shape `from-session` writes today.
5. `dryRun` returns both sets WITHOUT any registry write (entries built with
   placeholder ids; the result is for rendering only).
6. Writes go through `registry.createMemoryEntry` one row at a time (the
   same path from-session uses). **Never mutates an existing entry.**
   Detection stays OFF (`saveMemoryWithLineage` not used — same
   architect-#5 rationale as from-session: bulk extraction must not
   auto-link/close). For the same reason, born-approved autopilot rows do
   NOT run `applySupersession` (that close fires only on the human
   approve-flip path in `approve.ts`); extraction candidates carry no
   `supersedesId`, so there is no declared target to close anyway.

`cappedOut > 0` renders as a notice ("3 more qualified — raise
--max-per-session or approve in digest") so the cap is never silent.

## 6. CLI

All under the existing `brainCommand`. New files
`apps/cli/src/commands/brain/autopilot.ts` + `digest.ts`.

### 6.1 `mega brain autopilot` (policy + manual trigger)

```
mega brain autopilot status      # enabled?, policy, pending suggested count, last digest
mega brain autopilot on  [--auto-approve-types bug,test_behavior] [--max-per-session 10]
mega brain autopilot off
mega brain autopilot run --session <id> [--project <name>] [--dry-run] [--json]
```

- `status`/`on`/`off`: FREE (policy file edit only; `on` prints what will
  happen at the next entitled run).
- **`enabled` semantics (architect M3):** real `run` HONORS the toggle —
  `enabled:false` ⇒ `run` refuses with
  `autopilot is off — enable with: mega brain autopilot on` (exit 1, zero
  writes). `run --dry-run` works regardless of `enabled` (it is the free
  proof surface). This gives the toggle a real v1 effect; the wave-2
  triggers will read the same field.
- `run --dry-run`: FREE — prints the would-approve/would-stage split with a
  `DRY RUN — nothing written` banner. This is the free proof surface AND the
  DoD smoke evidence.
- `run` (real): PRO gate FIRST (`checkEntitlement("brain-autopilot")`);
  unentitled → one upsell line + exit 0, zero work, zero writes.
- `--auto-approve-types` validates against `memoryTypeSchema` values;
  unknown type → exit 1 with the valid list.
- Output (table mode): `auto-approved N · staged M · skipped K (already
  captured) · capped C`, then one line per row (id, type, title). `--json`
  emits `AutopilotRunResult` with full entries.

### 6.2 `mega brain digest` (PRO)

Single-keystroke triage over ALL recallable-pending suggested rows (the
whole backlog, not only autopilot output), grouped by session (newest
first), then project-scope rows.

- PRO gate FIRST; unentitled → upsell + exit 0.
- Header per group: session title/id, ended-when, `N auto-approved while you
  were away` (collapsed spot-review — expand with `a`), `M pending`.
- Keys: `y` approve · `n` reject · `e` open `$EDITOR` on title/content then
  approve · `s` skip · `u` undo last decision · `a` expand auto-approved
  spot-review (then y keeps / n revokes to suggested) · `q` quit.
- Approve/reject route through `runMemoryApprove` — the EXISTING op, so
  i1's decay-safe flip, the declared-target supersession close, and the
  no-op guard fire for free. No new approval logic.
- `u` (undo) / spot-review revoke need a `suggested` target, which
  `RunMemoryApproveInput.approval` (`"approved" | "rejected"`,
  `approve.ts:10`) does not admit today. **Contained change:** widen the
  union to `"approved" | "rejected" | "suggested"`; the `approved` branch
  (supersession) is untouched, the existing no-op guard already handles
  same-state, and the public `approve`/`reject` CLI commands keep their
  two fixed targets — only digest passes `"suggested"`. Single-level undo.
  NOTE: undo after an approve that closed a predecessor (declared-target
  supersession) reverts ONLY the approval flip; the predecessor stays
  closed — `mega memory reopen` is the documented recovery for that row
  (rendered in the undo confirmation line when a close happened).
- Empty queue: `Nothing to triage — 0 failures recorded since <lastDigestAt>.`
  (thin-digest honesty: says what was scanned, never fakes work).
- On quit: writes `digest-state.json` (`lastDigestAt: now`).
- **Non-TTY fallback (hard requirement):** `process.stdout.isTTY === false`
  OR `--json` ⇒ NO raw mode. `--json` prints the pending queue as JSON and
  exits 0 (read-only). Plain non-TTY prints the queue with numbered ids +
  a hint to use `mega memory approve/reject <id>`. Raw-mode keystroke loop
  only on a real TTY. CI/pipes never hang.
- **Raw-mode lifecycle (architect M5, hard requirements):** cooked mode is
  restored and keypress listeners removed in a `finally` AND on
  `SIGINT`/`SIGTERM` before exit — a Ctrl-C mid-digest must never leave the
  shell in raw/no-echo mode. `e` with `$EDITOR` unset ⇒ message + treated
  as skip; editor exiting non-zero ⇒ that row's approve is aborted (stays
  `suggested`); the raw loop is paused (raw off, listeners detached) while
  the editor child owns the TTY and resumed after. Terminal resize is
  ignored (redraw on next keystroke). The keystroke loop lives in one
  module with an injected input stream (testable without a real TTY).
- **I/O plumbing (architect m9):** the digest opens the registry ONCE and
  reuses it across the loop; `runMemoryApprove` is called with CAPTURED
  stdout/stderr sinks so per-row output (including the "closed predecessor
  — mega memory reopen <id>" supersession note) renders inside the digest
  UI instead of corrupting the raw-mode screen, and with the store already
  resolved (no per-keystroke store re-resolution — extract the core flip
  into a helper shared by the CLI command and the digest if needed).
- `--limit N` caps rendered rows (default 50, newest first).

### 6.3 Unchanged surfaces

`mega memory from-session` stays FREE/manual and byte-identical.
`mega memory review/approve/reject` unchanged (digest is a faster skin over
the same ops).

## 7. Gating

`ProFeature` union += `"brain-autopilot"` (one-line; `checkEntitlement`
feature-agnostic — key documents intent).

| Surface | Tier |
|---|---|
| `autopilot status/on/off` + `run --dry-run` | FREE |
| `autopilot run` (real writes, auto-approve) | PRO |
| `mega brain digest` (TUI + `--json`) | PRO |
| `from-session`, `review`, `approve`, `reject` | FREE (unchanged) |

Free proves the extraction is real and shows the labor; Pro removes the
labor. No nudges in v1 (trigger wave owns the once-daily upsell line).

## 8. Safety invariants (non-negotiable)

1. **Allowlist-only auto-approve** — `type ∈ autoApproveTypes`, checked
   against the schema enum at the CLI boundary.
2. **Never mutates existing entries** — autopilot only creates NEW rows;
   the only path that flips approval is the human digest/approve ops.
3. **Provenance always** — every auto-approved row carries
   `autopilot@1 rule=<ruleId> session=<id>` in `evidence[]`; a row without
   that line was not auto-approved (auditable).
4. **Per-session cap** — hard, order-deterministic, surplus reported.
5. **Reversible** — digest spot-review revokes an auto-approval back to
   `suggested`; reject/undo cover the rest. Nothing is deleted.
6. **Fail-closed policy** — missing/corrupt `autopilot.json` ⇒ disabled;
   corrupt state can never enable auto-approval.
7. **Gate-first** — entitlement check precedes ALL work and ALL writes on
   Pro surfaces.
8. **No LLM, no network** — scoring is a pure rule table; deterministic
   over recorded rows (CI-safe).
9. **Redaction upstream** — candidates derive from FailedAttempt rows that
   passed the firewall redaction at capture time; autopilot adds no new raw
   input path.

## 9. Testing

- **scoreCandidate:** pure table tests — priorSessionHit true/false, type
  gate (`bug`/`test_behavior` vs `decision`), extractor-confidence
  passthrough; the M2 regression: a single-session retry storm
  (occurrences 5, priorSessionHit false) stays low/medium — NEVER high.
- **occurrences field:** extractor counts collapses (3 identical failures →
  1 candidate, `occurrences: 3`); existing session-memory tests unchanged.
- **runAutopilot:** existing JSON-store harness — approve/stage split; cap
  (11 qualified → 10 approved + 1 staged + cappedOut 1); cross-run
  idempotence (second run → all skippedExisting); from-session interop
  (autopilot then from-session = no-op, and reverse); dry-run writes NOTHING
  (store byte-identical); evidence provenance + validFrom/lastActiveAt on
  approved rows; suggested rows byte-identical to from-session output.
- **Policy store:** roundtrip, corrupt file ⇒ default-disabled, atomic write.
- **CLI autopilot:** gate-first (unentitled run writes nothing, upsell to
  stdout, exit 0); dry-run banner; --json shape; bad --auto-approve-types
  exit 1.
- **Digest:** injected-keystroke harness (y/n/e/s/u/a/q against a scripted
  stdin), approve/reject routed through the real ops, undo flips back,
  spot-review revoke, empty-state line, --json read-only, non-TTY numbered
  fallback (no raw mode, no hang), digest-state written on quit.
- **E2E smoke (DoD):** the WOW loop through the real binary — the SAME
  failure recorded in session A, then again in session B (cross-session
  recurrence, the dampener's qualifying signal) → `autopilot run --session
  <B>` → 1 auto-approved (high, `rule=recurring-failure` provenance,
  validFrom/lastActiveAt stamped) + the rest staged → `brain digest` → y/n
  triage → recall cites the auto-approved memory. Also capture the negative:
  a single-session double failure auto-approves NOTHING (dry-run shows it
  staged only).

TDD per task; `pnpm verify` green; gauntlet (fresh code-reviewer + fresh
adversarial critic, opus) over the full branch; verifier re-pass on fixes.

## 10. Out of scope (v1 — each deferred to its own spec)

- Auto-triggers: Claude Code SessionEnd hook, `mega session end` inline run,
  daemon `autopilot/run` RPC (wave 2).
- GUI DigestPanel + bridge approve/reject WriteActions (wave 3).
- Once-daily unentitled nudge line (belongs to the trigger wave).
- New extraction inputs (task-plan completions, session summaries — the i5
  overlap); v1 ships on today's failure-driven extractor.
- Per-project policy overrides.
- `test_behavior` in the default allowlist (extractor doesn't produce it).

## 11. Risks

1. **Thin digest (biggest product risk):** clean sessions yield empty
   digests. Mitigation: honest empty-state naming what was scanned;
   fast-follow extraction inputs are a separate pipeline spec — autopilot/
   digest do not change when sources plug in.
2. **Auto-approve poisoning recall:** junk entering `approved` silently
   degrades every recall surface. Mitigation: §8 invariants (allowlist +
   high-only + cap + provenance + spot-review revoke).
3. **Raw-mode TTY is new for this CLI:** everything else is line-printed.
   Mitigation: §6.2 non-TTY fallback is a hard requirement with tests; the
   keystroke loop is isolated in one module with an injected input stream.
4. **Backlog shock:** first digest may show hundreds of legacy suggested
   rows. Mitigation: `--limit` default 50 + newest-first ordering + count in
   the header ("showing 50 of 312").
5. **Dedupe-keyword coupling:** autopilot reuses `from-session:<dedupeKey>`
   keywords as its idempotence ledger. The prefix is NOT shared today — a
   local const duplicated in `from-session.ts:32` AND the MCP
   `from-session-memory.ts:27` (architect m6). This feature PROMOTES it to
   a single `@megasaver/core` export (beside `extractSessionMemories`) and
   rewires both existing call sites + autopilot to import it — three copies
   would drift.
