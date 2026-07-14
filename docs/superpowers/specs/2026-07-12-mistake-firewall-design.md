# Mistake Firewall (guard) — Design

- **Date:** 2026-07-12 (rev 2 — architect pass applied)
- **Risk:** HIGH (§12 — connector core path, new store surface, public CLI flags). Chain: architect pass (done, APPROVE-WITH-FIXES applied) + worktree + code-reviewer AND critic (fresh contexts).
- **Idea:** i7 in [wiki/syntheses/memory-moat-portfolio.md] (score 30.3/40). Sketch: [wiki/syntheses/memory-moat-sketches.md] §i7.
- **Approved scope (user, 2026-07-12):** full sketch v1; free/pro split per sketch.
- **Naming:** market name "Mistake Firewall"; internal module and CLI name `guard`. `firewall` already means secret redaction in this repo (`packages/pro-analytics/src/firewall-report.ts`, `mega firewall` command) — never reuse it.

## 1. Problem

Agents repeat recorded mistakes. The store holds failure knowledge — durable `FailedAttempt` rows (curated via `mega fail record` / `record_failed_attempt` MCP) and auto-captured proxy failures — but nothing consults it at the moment an agent is about to re-run a known-bad command or re-edit a known-bad path. Recall is pull-only; the mistake happens before anyone pulls.

Guard makes the store *active*: a PreToolUse hook intercepts Bash/edit tool calls that match stored failures and warns the agent mid-mistake, with the estimated token cost of the original failure attached.

## 2. Corrections to the sketch (binding — verified against code)

**B1 — No hook-path failure capture; auto corpus is a new durable store, not SessionFailure.** The sketch says the PostToolUse saver hook records failures "on nonzero exit". Claude Code's PostToolUse `tool_response` for Bash is `{stdout, stderr, interrupted, isImage}` — **no exit code** (`apps/cli/test/hooks/saver.test.ts:40`). Only the proxy path (`run-command.ts`) sees `childExitCode`. Additionally (architect blockers): `SessionFailure` is session-scoped (`listSessionFailures(projectId, sessionId)` only — no project-wide read) and **ephemeral by design** — `endSession` wipes the rows (`json-directory-registry.ts:222`). It cannot be guard's corpus.

**Resolution — guard corpus:** at the existing proxy capture site (`run-command.ts`, next to `createSessionFailure`, same best-effort try/catch), also append a row to a new durable, bounded, per-project JSONL: `guard/<projectId>.failures.jsonl`. SessionFailure itself is untouched (stays ephemeral; no schema change, no registry change, no `registry-port.ts` mirror change). Guard reads two sources: `FailedAttempt` registry (curated) + guard corpus (auto, durable). The registry-less overlay JSONL stays out of scope.

**B2 — Estimated pricing, never summed into savings.** Measured waste exists only where the proxy sees raw output. The guard corpus row carries `wastedTokens` = `estimateTokens(outcome.capture.raw)` (full raw, before the 4000-char slice; `estimateTokens` from `@megasaver/output-filter`). `FailedAttempt` gets **no** new field; fallback price = `estimateTokens(errorOutput)` when present, else no dollar line. Every guard figure is labeled **estimated** (`estimated: z.literal(true)` on events, "(estimated)" in all text) and is **never** added to `TokenSaverEvent` savings totals, `savedSoFar`, or any measured aggregate — same discipline as `WarmStartEvent`. ROI surfaces print a *separate* line.

**Cold start (honest):** proxy/`mega run` users seed the guard corpus from day 1. Pure-hook users seed via `record_failed_attempt` — which is NOT currently instructed anywhere (architect-verified); the connector-block instruction line added in §6 is what creates that path. Until seeded, guard is silent — by design.

## 3. Data model

### 3.1 Guard corpus — `packages/context-gate/src/guard-corpus.ts` (new)

**Placement note (dependency direction):** core depends on context-gate, not the reverse — `run-command.ts` (the capture site) cannot import core. The corpus module therefore lives in context-gate beside `overlay-failures.ts` (same bounded-append pattern, same `atomicWriteFile`); core's `guard-match.ts` imports the row type from `@megasaver/context-gate` (already a core dependency), and the CLI imports it directly (precedent: `saver-run.ts`).

Append-only JSONL at `<storeRoot>/guard/<projectId>.failures.jsonl`, bounded: writes keep only the newest `GUARD_CORPUS_MAX = 200` rows (rewrite-on-append with tmp+rename, mirroring `overlay-failures.ts` MAX-bounded append). Torn/invalid lines skipped on read.

```ts
export const guardCorpusRowSchema = z.object({
  id: z.string().uuid(),
  command: z.string().min(1),        // redacted label, argv-joined (same value SessionFailure stores)
  errorOutput: z.string(),           // redacted, ≤4000 chars (same slice as SessionFailure)
  wastedTokens: z.number().int().nonnegative(),
  createdAt: z.string().datetime({ offset: true }),
}).strict();
```

`appendGuardCorpusRow(rootDir, projectId, row)` (best-effort semantics owned by the caller), `readGuardCorpus(rootDir, projectId): GuardCorpusRow[]`. Write site: `packages/context-gate/src/run-command.ts` inside the existing non-benign-failure branch, wrapped in its own try/catch that folds into `captureWarnings` — a corpus write failure never breaks command delivery, exactly like the SessionFailure capture beside it.

### 3.2 Matcher — `packages/core/src/guard-match.ts` (new, pure)

No I/O, no clock reads — caller passes `asOf` ISO string. Mirrors `warm-start.ts` purity.

```ts
export type GuardCandidate =
  | { kind: "failed-attempt"; attempt: FailedAttempt }
  | { kind: "auto-capture"; row: GuardCorpusRow };

export type GuardToolCall =
  | { tool: "Bash"; command: string }
  | { tool: "Edit" | "Write" | "MultiEdit" | "NotebookEdit"; filePath: string; text: string };
  // text = new_string/content/cells joined — the edit context for the T2 BM25 signal

export type GuardMatchInput = {
  call: GuardToolCall;
  candidates: GuardCandidate[];
  mutedIds: string[];          // from guard state
  firedIds: string[];          // candidate ids already fired this session (cooldown)
  asOf: string;                // ISO
};

export type GuardMatch = {
  candidate: GuardCandidate;
  tier: "t1" | "t2" | "t3";
  action: "warn" | "deny-capable" | "recall";
  // deny-capable: hook layer downgrades to warn unless mode=strict
};

export function matchGuard(input: GuardMatchInput): GuardMatch | null;
export function normalizeCommand(command: string): string;
```

**Normalization (`normalizeCommand`):** trim; collapse internal whitespace runs to single spaces; strip leading `VAR=value` env-assignment prefixes. No flag reordering in v1 (semantic risk; deferred). Known, test-documented limits (architect finding): corpus commands are redacted and argv-joined, so shell quoting is lost (`grep "foo bar" x` stored as `grep foo bar x`) and secret-bearing raw commands never T1-match their redacted stored form — both cases in the adversarial test table.

**Tiers — first hit wins; muted and already-fired ids are excluded before matching:**

- **T1 EXACT** → `deny-capable`. `normalizeCommand(call.command)` strictly equals `normalizeCommand(candidate command)`. Candidate command: `GuardCorpusRow.command`, or `FailedAttempt.failedStep` (free text — equality after normalization is the filter). Only unresolved candidates (`resolution` unset; corpus rows are always unresolved) younger than 30 days (`createdAt` vs `asOf`, strict `<`).
- **T2 PATH** (edit tools only) → `warn`. Requires BOTH signals: `call.filePath` intersects `FailedAttempt.relatedFiles` (compare normalized relative paths; suffix match on the shorter) AND BM25 score > 0 of `call.text` against the attempt's text surface. Corpus rows have no `relatedFiles` — T2 is FailedAttempt-only.
- **T3 BM25** (Bash only) → `warn`. Text surfaces: FailedAttempt = `task + failedStep + errorOutput + suspectedCause` (the `searchFailedAttempts` surface); corpus row = `command + errorOutput`. Ranked via `rankBm25` (`@megasaver/retrieval` — core already depends on it). Conservative gate: `top1.score >= GUARD_T3_MIN_SCORE` AND (`top2` absent or `top1.score >= GUARD_T3_MARGIN * top2.score`). Constants live in `guard-match.ts`; **the table-driven test suite is the tuning authority — the matcher tests ARE the spec** (adversarial near-misses required: same command different repo, resolved failures, stale failures, prose mentioning a command, benign flag variations, quoting-loss and redaction cases).
- **Resolved recall:** a `FailedAttempt` with `resolution` set never warns or denies. If it T1/T3-matches, emit `action: "recall"` with the resolution text ("solved before: …").
- 30-day age gate applies to T1 only. `convertedToRule` attempts are excluded everywhere (they became rules; rules ship in warm-start briefs).

### 3.3 Guard events — `packages/stats/src/guard-event.ts` (new)

Mirrors `warm-start-event.ts` verbatim in pattern: strict Zod, `safeParse` → `StatsError("schema_invalid")`, JSONL append, torn-line-skipping reader, path `stats/<projectId>/guard.events.jsonl`. Re-exported through core's `context-gate.ts` allow-list (CLI never imports stats directly). **Analytics ledger only — never read on the hook hot path** (cooldown lives in guard state, §3.4).

```ts
export const guardEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("intercept"),
    id: z.string().uuid(),
    projectId: projectIdSchema,
    sessionId: z.string().min(1),
    matchedId: z.string().min(1),               // FailedAttemptId | corpus row id
    matchedKind: z.enum(["failed-attempt", "auto-capture"]),
    normalizedCommand: z.string().nullable(),   // Bash intercepts; null for edit-tool intercepts
    tier: z.enum(["t1", "t2", "t3"]),
    action: z.enum(["warn", "deny", "recall"]),
    avoidedTokens: z.number().int().nonnegative(),   // 0 when no price known
    estimated: z.literal(true),
    createdAt: z.string().datetime({ offset: true }),
  }).strict(),
  z.object({
    type: z.literal("outcome"),
    id: z.string().uuid(),
    projectId: projectIdSchema,
    sessionId: z.string().min(1),
    interceptId: z.string().uuid(),
    outcome: z.enum(["overridden-ok", "overridden-failed", "overridden"]),
    createdAt: z.string().datetime({ offset: true }),
  }).strict(),
]);
```

JSONL is append-only; outcomes are separate rows referencing `interceptId` — never in-place updates. `normalizedCommand` on the intercept row is what lets the outcome loop match a re-run without any registry lookup (architect finding 4). **`heeded` is computed at read time**: an intercept row with no outcome row. Not stored.

### 3.4 Guard state — `packages/core/src/guard-state.ts` (new)

`<storeRoot>/guard/<projectId>.json`. Pattern copied from `warm-start-state.ts`: best-effort read (`null` on missing/corrupt), tmp+rename write, no fsync. Concurrent writers (guard hook, saver outcome step, CLI) — **last-writer-wins is blessed**; a lost cooldown entry or strike is advisory data, corruption is what tmp+rename prevents.

```ts
export type GuardState = {
  mode: "warn" | "strict";                       // default "warn"
  mutedIds: string[];                            // manual + auto mutes
  autoMuted: Record<string, number>;             // candidateId -> overridden-ok strikes
  sessions: Record<
    string,
    {
      firedIds: string[];
      intercepts: Record<string, { command: string; signatures: string[] }>;
    }
  >;
  // firedIds: per-session cooldown (each candidate fires once per session)
  // intercepts: interceptEventId -> normalized command + the ORIGINAL failure's
  // extractFailureSignatures, captured at intercept time so the PostToolUse
  // outcome step needs no registry/corpus read at all
};
```

`sessions` capped at the newest `GUARD_STATE_MAX_SESSIONS = 20` (insertion-order eviction on write). Hook hot path reads only this one small file for cooldown + mode — never the events JSONL (architect finding 7).

## 4. Hook path

### 4.1 `apps/cli/src/hooks/guard-run.ts` + `apps/cli/src/commands/hooks/guard.ts` (new)

`mega hooks guard` — PreToolUse entrypoint, registered in `apps/cli/src/commands/hooks/index.ts` + `main.ts`. Contract identical to warmup: **NEVER throws, never blocks** — any internal error ⇒ empty stdout, exit 0 (set `exitCode = 0` first). Testable core `buildGuardHookOutput(input): string` + thin `runGuardHookFromProcess`.

Flow: read stdin JSON → extract `tool_name`, `tool_input`, `session_id`, `cwd` → store via `resolveStorePath(readStoreEnv(undefined))` + `ensureStoreReady` (warmup-run precedent) → resolve project via `findProjectByCwd` → no project ⇒ empty. Reads per invocation (all small/bounded): projects list, failedAttempts, guard corpus (≤200 rows), guard state. Run `matchGuard`. On match:

- **warn / recall:** emit `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": "<text>"}}`. **NEVER emit `permissionDecision: "allow"`** — that would bypass the user's permission system. Warn text (English, one block):
  > ⛨ Mistake Firewall: you tried this on 2026-07-11 and it failed: `<errorTail ≤200 chars>`. Suspected cause: `<suspectedCause>`. That failure cost ~18,200 tokens (~$0.27, estimated). Cumulative retry-cost avoided: `mega roi` (Pro).
  Dollar/token sentence omitted when no price is known. Recall text: "you solved this before: `<resolution>`".
- **deny:** only when `state.mode === "strict"` AND `match.action === "deny-capable"` (T1). Emit `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "<same text + override hint: mega guard mute <id> or mega guard mode warn>"}}`. Strict enforcement lives at `mega guard mode` write time only; the hook trusts the state file (a hand-edited or license-expired strict state still denies — accepted, documented).
- Best-effort side writes (own try/catch; never suppress the warn output): append intercept guard-event; update guard state (`firedIds` += candidate id, `interceptCommands[eventId] = normalizedCommand` for Bash).
- No match ⇒ empty stdout.

`avoidedTokens` = corpus `wastedTokens` ?? `estimateTokens(FailedAttempt.errorOutput)` ?? 0. Token→USD via the existing re-exports (`INPUT_PRICE_PER_MTOK_USD` / `formatDollarsSaved` path in `core/src/context-gate.ts`).

**Latency budget (task-1 pass/fail gate):** p50 < 150 ms end-to-end for the no-match case, measured in the week-1 smoke (Node cold start included). Every read above is a small bounded file; if the gate fails, the daemon fast-path (deferred) gets pulled forward — decision point, not silent acceptance.

**additionalContext assumption:** PreToolUse `hookSpecificOutput.additionalContext` support has no in-repo evidence (architect-confirmed); external knowledge says current Claude Code supports it. Task 1 includes a real-session smoke validation; if unsupported, fallback is plain-stdout (transcript-only) and the warn value drops — flag to user before proceeding past task 1.

### 4.2 Hook install — `packages/connectors/claude-code/src/hook-settings.ts` (extend)

- `"guard"` joins the `buildHookCommand` union; `GUARD_HOOK_COMMAND = "mega hooks guard"`.
- `GUARD_HOOK_MATCHER = "^(?:Bash|Edit|Write|MultiEdit|NotebookEdit)$"` — guard never runs on Read/Grep/etc.
- New `addGuardHook` / `hasGuardHook` / `removeGuardHook`: a **second** PreToolUse entry (the log hook owns the first; `addPreToolUseHook` hardcodes `HOOK_MATCHER` so guard gets its own function — architect-verified the entry plumbing is multi-entry-safe, `install.test.ts:60`). 10s timeout like the others.
- Install writes it by default (`input.guard !== false`); `--no-guard` CLI flag on `mega hooks install` / `mega init`. Uninstall removes it. `status` gains `guardInstalled` — NOT folded into `connected` (same as `warmupInstalled`).

### 4.3 Outcome loop — saver hook extension

**Insertion point (binding):** in `buildSaverDecision` (`apps/cli/src/hooks/saver.ts:224`) / `saver-run.ts` — ABOVE `decide()`, because `decide()` PASSTHROUGHs early on small outputs (24 KB Bash floor) and failing re-runs are usually small (architect finding 8). Own try/catch; never affects the compression decision. Skip the entire step when no guard state file exists for the project (zero cost for non-guard users).

- Bash only. `normalizeCommand(tool_input.command)`; look up the session's `intercepts` in guard state; on match, classify the re-run output by **signature overlap with the original failure** (architect finding 3): the intercept's stored `signatures` (computed at intercept time via `extractFailureSignatures(originalErrorOutput)` — export it from `@megasaver/context-gate`, currently internal; CLI already legitimately depends on context-gate) → if the re-run output contains any of those original signatures ⇒ `overridden-failed`; if the stored signature list is empty ⇒ `overridden` (unclassified — never counts toward strikes); else ⇒ `overridden-ok`. No registry or corpus read on either hook path.
- Append the outcome row; **auto-mute:** on `overridden-ok`, increment `autoMuted[candidateId]`; at 3 strikes add to `mutedIds`. `mega guard unmute` clears both.
- Edit-tool intercepts are not outcome-classified in v1 (no failure signal in edit responses); they stay `heeded`-by-default — stated in `mega guard status` methodology output.

## 5. CLI — `apps/cli/src/commands/guard/` (new)

- `mega guard status` — installed?, mode, intercepts this month (warn/deny/recall counts), override counts, FP proxy = overridden-ok / warns (with the edit-tool caveat printed), mute count. Free.
- `mega guard mode <warn|strict>` — strict is Pro (`checkEntitlement("savings-analytics")`, gate-first, upsell exit 0 — `WARMUP_WRITE_UPSELL` pattern, `commands/warmup.ts:24`). `warn` always allowed (downgrade never gated).
- `mega guard events [--limit N] [--json]` — intercept ledger with matched failure, tier, action, outcome, estimated tokens/$. Pro.
- `mega guard mute <candidateId>` / `unmute <candidateId>` — free.
- `mega guard check "<command or description>"` — dry-run matcher against the current project's store; prints match tier/action/reason or "no match". Free (demo + FP debugging).
- All follow the warmup.ts shape: testable `runGuardX(input)` + thin Citty wrapper, registered in `main.ts`.

## 6. MCP — `check_approach` (new tool, 34th) + `find_similar_failures` cap

`packages/mcp-bridge/src/tools/check-approach.ts`. Input (zod strict): `{projectId, description: string (min 1), files?: string[]}`. Runs `registry.searchFailedAttempts` (text = description) + T2-style `relatedFiles` intersection when `files` given; returns capped matches `{task, failedStep, suspectedCause?, resolution?, createdAt, estimatedWasteTokens?}` (top 5). Errors: `validation_failed` / `resource_not_found` — same mapping as `get_warm_start_brief`. Tool registration: enum + `TOOL_DEFS` + server switch; update the three tests hardcoding 33 (`tool-name-task.test.ts`, `server.e2e.test.ts:537`, `tool-name.test-d.ts:55`).

**Entitlement:** mcp-bridge keeps zero entitlement deps (precedent, `get-warm-start-brief.ts:26-28`). `mega mcp serve` builds deps CLI-side where `@megasaver/entitlement` is already a dependency (`commands/mcp/serve.ts:29`): run `checkEntitlement("savings-analytics")` once at startup, inject `ServerDeps.isPro: boolean` (default false). Free ⇒ candidates filtered to `createdAt` within 7 days + one upsell line in the response; Pro ⇒ full history.

**Overlap with `find_similar_failures` (architect finding 5):** that existing tool is the same BM25 search, ungated, full-history — it would trivially bypass the free cap. Binding decision: apply the SAME `isPro` 7-day filter to `find_similar_failures` in this feature (pre-1.0, no compat shims per §13). `check_approach` remains the instructed, guard-flavored surface (adds `files` intersection, resolution + waste pricing in output); possible v2 consolidation noted, not built.

**Connector-managed block** (shared context renderer, `packages/connectors/shared/src/context-gate-block.ts`) gains two instruction lines — this is what creates the cold-start seeding path (architect finding 6):
1. "After an approach fails, record it with record_failed_attempt."
2. "Before retrying something that previously failed, call check_approach."
PreToolUse interception remains Claude-Code-only; stated honestly.

## 7. ROI / savings integration (`packages/pro-analytics` + savings commands)

- New reader `readGuardTotals` (pattern: `defaultWarmStartTotalsReader` in `commands/savings/shared.ts`): heeded intercept count, Σ `avoidedTokens` over heeded intercepts, override counts.
- `mega roi`, `mega savings history`, `mega savings insights`, `forecast`: one added line — `Retry cost avoided (estimated): ~N tokens (~$X) across M intercepts`. Text branch only; **never** added to `savedSoFar`/measured totals; null-rendered when 0. All four surfaces are already Pro-gated via `checkEntitlement` (architect-verified).
- `mega savings fix` suggests enabling guard when not installed.
- Ledger export surface = `mega guard events --json` (Pro). `pro-analytics/export.ts` is row-shape-generic over `SavingsRow` (TokenSaver history/project rows) — guard events do not fit that union and get no CSV path in v1.

## 8. Free/Pro split (existing `savings-analytics` key; NO new entitlement key)

| Surface | Free | Pro |
|---|---|---|
| Warn/recall interception + reason + one-shot $ line | ✔ | ✔ |
| `guard status` counters, `guard check`, mute/unmute | ✔ | ✔ |
| Strict (deny) mode | — | ✔ |
| `guard events` ledger + export | — | ✔ |
| ROI/history/insights/forecast cumulative line | — | ✔ (surfaces already Pro) |
| `check_approach` AND `find_similar_failures` | last 7 days | full history |

Every free intercept prints the Pro pointer line — the intercept is the ad. Note: `checkEntitlement` currently ignores its feature argument (tier-based; `entitlement.ts:37`) — pre-existing, unchanged here.

## 9. Out of scope (v2, do not build)

- llm-proxy passive plan scanner.
- Daemon fast-path matcher (pulled forward only if the task-1 150 ms gate fails).
- Overlay-failures JSONL as a guard source; SessionFailure lifecycle changes.
- Hook-path automatic failure capture (revisit if Claude Code adds exit codes to `tool_response`).
- Flag-order command normalization.
- `find_similar_failures` / `check_approach` consolidation.

## 10. Testing & verification

- **Matcher** (`packages/core/test/guard-match.test.ts` — the tuning authority): T1 hit/miss on whitespace + env-prefix variants; 30-day boundary (strict `<`); resolved ⇒ recall; muted/fired exclusion; T2 two-signal requirement (path-only and text-only both miss); T3 threshold + margin; `convertedToRule` exclusion; prose-vs-command non-collision; quoting-loss (`grep "foo bar"` vs stored `grep foo bar`) and redacted-command non-match documented as expected misses.
- **Corpus:** bounded append (201st row evicts oldest), torn-line skip, capture-site best-effort (corpus write throw folds into warnings, command delivery unaffected).
- **Hook:** fail-open (bad stdin, missing project, registry throw, mid-flight throw ⇒ empty + exit 0); warn JSON shape; no `permissionDecision` on warn; deny only strict+T1; cooldown across two calls same session (state-file based); state `sessions` eviction at 20.
- **Saver extension:** outcome rows appended; runs on small (sub-floor) outputs — regression proves insertion above `decide()`; signature-overlap classification (original-signature present ⇒ failed; zero-signature original ⇒ `overridden`); auto-mute at 3 strikes; compression behavior untouched; zero-cost skip when no guard state.
- **Events schema:** torn-line skip; discriminated union rejects unknown type.
- **CLI/entitlement:** strict-mode gate-first upsell; events Pro gate; free 7-day cap on BOTH `check_approach` and `find_similar_failures`.
- **Smoke evidence (DoD §9.5):** record a fake failed attempt, feed a real PreToolUse JSON into `mega hooks guard`, capture the warn output; real-session additionalContext validation; latency measurement vs the 150 ms gate.
- `pnpm verify` green; build before tests (sibling packages resolve from dist).

## 11. Effort / slicing (plan will decompose)

Order: guard corpus + capture-site write → matcher (core) → guard events + state → hook + install → saver outcome loop → CLI → MCP (`check_approach` + `find_similar_failures` cap + `isPro` injection) → roi/savings lines → connector instruction lines → gauntlet. Each step lands with its tests; demoable after the hook step.
