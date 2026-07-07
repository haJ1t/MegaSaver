---
title: Pro module 5 — waste remediation (mega savings fix)
date: 2026-07-07
status: approved
risk: HIGH
scope: a fifth proprietary pro-analytics module (deterministic fix-plan engine over WasteRows) + a gated `mega savings fix [--apply]` command. Writes ONLY Mega-Saver-owned store config (workspace saver record) via the existing locked atomic API; user repo files are read-only (sizes). No entitlement/crypto change; no new storage schema.
base: main (2574e0b3)
reviewers: [code-reviewer, critic]
manual-confirmation: given (user approved design 2026-07-07 — propose+apply model, 4-item catalog with #2/#3 downgraded to advice after surface exploration, print-previous no undo infra, fixed deterministic thresholds)
---

# Pro module 5 — waste remediation (`mega savings fix`)

## Motivation

Module 2 (`savings insights`) diagnoses where tokens still leak; nothing
turns that diagnosis into treatment. `mega savings fix` maps each waste
finding to a concrete remediation — applying the ones Mega Saver can safely
do itself and printing ready-to-run advice for the rest. Diagnostic →
treatment; Pro feels alive (source:
wiki/syntheses/pro-differentiation-portfolio.md E2).

## Locked decisions (user-approved 2026-07-07)

1. **Propose + apply**: default run prints the fix plan (every action tagged
   `[apply]` or `[advice]`); `--apply` executes ONLY `[apply]` actions, and
   those write ONLY Mega-Saver-owned store files. User repo files are never
   written (CLAUDE.md/AGENTS.md are stat'd for size only).
2. **v1 catalog** (post-exploration reality): R1/R2 saver enable/bump are the
   only real writes — the persisted surface exists
   (`@megasaver/context-gate` saver-store). Outline toggle (no persisted
   setting exists; per-call flag only) and tool-router block (event
   `sourceKind/label` does not map 1:1 to a registered `ToolDefinition`)
   ship as `[advice]` with ready-to-run commands, NOT silent writes.
   Memory-file compression is `[advice]` until a product compressor exists
   (prose-compressor spec is unimplemented).
3. **No undo infra**: every write prints `was: <old> → now: <new>`;
   reverting is one existing command. No backup store, no `--undo`.
4. **Fixed deterministic thresholds** locked in this spec (no flags, no LLM).
5. **Never auto-aggressive**: mode bumps stop at `balanced`;
   `aggressive` is only ever advice.

## Design

### 1. Proprietary pure engine — `packages/pro-analytics/src/fix.ts`

Thresholds (exported consts): `FIX_MIN_EVENTS = 20`,
`FIX_CHATTY_SHARE = 0.25`, `FIX_CHATTY_RATIO = 0.3`,
`FIX_READ_SHARE = 0.4`, `FIX_WEAK_RATIO = 0.5`,
`FIX_WEAK_MIN_TOKENS = 1_000_000`, `FIX_MEMORY_FILE_BYTES = 16_384`.

Types:

```
FixActionKind =
  | "enable-saver"            // R1, appliable
  | "bump-saver-mode"         // R2, appliable
  | "advise-tool-route"       // R3, advice
  | "advise-outline"          // R4, advice
  | "advise-compress-memory-file"; // R5, advice

FixAction = {
  kind: FixActionKind;
  appliable: boolean;
  title: string;              // one-line finding
  detail: string;             // why + what it does
  command: string | null;     // ready-to-run line for advice actions
  target: string | null;      // waste key or file path
  estDollarsReturned: number; // sizing basis (sort desc)
};

FixPlan = {
  headline: WasteHeadline;    // reuse computeWasteHeadline
  actions: FixAction[];       // sorted by estDollarsReturned desc
};
```

**`computeFixPlan(events, { saver, memoryFiles }): FixPlan`** where
`saver: { enabled: boolean; mode: TokenSaverMode } | null` (null = no record
resolvable) and `memoryFiles: { path: string; bytes: number }[]` (sizes
injected — the engine stays pure; the CLI stats files at the boundary).

Rules (evaluated over `computeWasteBreakdown` by `source` and by `label`):

- **R1 enable-saver** (appliable): `saver === null || !saver.enabled` →
  enable at `balanced`. `estDollarsReturned` = headline `dollarsReturned`.
- **R2 bump-saver-mode** (appliable): saver enabled at `safe` AND
  `overallSavingRatio < FIX_WEAK_RATIO` AND
  `tokensReturned ≥ FIX_WEAK_MIN_TOKENS` → bump `safe → balanced`.
  Never emitted for `balanced`/`aggressive` (aggressive is advice text
  inside `detail`, not an action).
- **R3 advise-tool-route** (advice): any source row with
  `returnedShare ≥ FIX_CHATTY_SHARE` AND `savingRatio < FIX_CHATTY_RATIO`
  AND `events ≥ FIX_MIN_EVENTS` → command
  `mega tools add <project> --name "<key>" --category mcp --risk caution`
  (+ `mega tools route` pointer in detail). One action per qualifying key.
- **R4 advise-outline** (advice): the `read` label row has
  `returnedShare ≥ FIX_READ_SHARE` AND `events ≥ FIX_MIN_EVENTS` → outline-
  first guidance (per-call `outline: true` via proxy read / MCP; note that
  unchanged re-reads are already deduped automatically).
- **R5 advise-compress-memory-file** (advice): each injected memory file
  with `bytes > FIX_MEMORY_FILE_BYTES` → advice to compress (interim:
  manual/skill-based; a product compressor lands as its own module).
  `estDollarsReturned` = `dollarsFromTokens(tokensFromBytes(bytes))`.

R1 and R2 are mutually exclusive by construction (R2 requires enabled).
Empty events → headline of zeros; R1/R5 can still fire. Export everything
from `src/index.ts`.

### 2. Gated CLI — `apps/cli/src/commands/savings/fix.ts`

`runSavingsFix(input)` mirrors the m1–m4 shape:

1. `checkEntitlement("savings-analytics", …)` FIRST; not entitled →
   `PRO_ANALYTICS_UPSELL`-style roi-precedent upsell
   (`FIX_UPSELL = "Waste remediation is a Mega Saver Pro feature. …"`,
   reusing `PRO_ANALYTICS_URL`), `return 0`, nothing read/computed/written
   (spy-enforced, including with `--apply` and `--json` set).
2. Entitled → lazy `await import("@megasaver/pro-analytics")`;
   `readAllEvents` (reuse `defaultSavingsEventReader`); saver state via
   injected `readSaver: () => { enabled; mode } | null` whose default impl
   wraps `resolveWorkspaceTokenSaverSettings(...)` from
   `@megasaver/context-gate` with `nodeResolverDeps` and
   `encodeWorkspaceKey(cwd)` (from `@megasaver/shared`); memory-file sizes
   via injected `readMemoryFileSizes: () => { path; bytes }[]` whose default
   stats `CLAUDE.md` and `AGENTS.md` under `cwd` (missing → omitted; never
   reads content).
3. `computeFixPlan(...)` → render:
   - default (propose): headline line + numbered actions, each prefixed
     `[apply]`/`[advice]`, `$` estimates via `formatDollarsSaved` + "(est.)",
     advice commands verbatim. Footer when any `[apply]` exists:
     `Run with --apply to apply N fix(es).` **Zero writes in this mode**
     (spy-enforced).
   - `--apply`: execute appliable actions inside `withActivationLock`:
     `writeExactRecord(storeRoot, workspaceKey, { enabled: true, mode:
     "balanced", scope: "exact" })`, printing
     `applied: <title> (was: <old-state> → now: enabled/balanced)`. Advice
     actions are re-printed unchanged. Nothing appliable →
     `Nothing to apply — N advice item(s) above.`, exit 0.
   - `--json`: `JSON.stringify({ plan, applied })` — `applied` only present
     with `--apply` (list of `{ kind, was, now }`).
   - no events AND no actions → `Nothing to fix — no waste signals yet.`,
     exit 0.
4. Write-path injection for tests: `writeSaver?: (rec) => void` defaulting
   to the real context-gate call, so CLI tests can both spy (propose mode
   writes nothing) and use a real temp store (apply mode round-trips).

Flags: `--apply`, `--json`, `--store <dir>`. Register `fix` in
`apps/cli/src/commands/savings/index.ts` alongside history/export/insights/
forecast.

### 3. Docs + changeset

- `README.md`: Pro code block lines (`mega savings fix`,
  `mega savings fix --apply`) + a bullet mirroring the shipped behavior
  (apply-vs-advice split stated honestly).
- `.changeset/savings-fix.md`: `@megasaver/cli` minor.

## Security / risk (HIGH)

Writes to the shared saver activation surface (the same record the saver
hook and GUI read) — via the EXISTING `withActivationLock` + atomic
`writeExactRecord` only; no new storage schema, no crypto, no user-repo
writes, no file content reads. §12 HIGH gates: worktree, code-reviewer AND
critic as separate passes, plus the 3-lens holistic final review used for
module 4. The critic must mutation-test the gate spies and the
propose-mode-never-writes invariant.

## Testing (TDD)

- **fix engine (pure)**: per-rule boundary tests — R1 (null saver /
  disabled); R2 fires only at `safe` + ratio/token thresholds (boundary at
  exactly 0.5 ratio → no fire; exactly 1M tokens → fire); R3 share/ratio/
  events boundaries (0.25/0.3/20); R4 read-share 0.4 boundary; R5 at
  16_384+1 fires, 16_384 doesn't; action sort order by estDollarsReturned;
  R1/R2 exclusivity; empty events. No NaN anywhere (zero-division guards
  inherited from insights helpers).
- **CLI fix**: no license (with and without `--apply`) → upsell, exit 0,
  spies assert `computeFixPlan`, `readAllEvents`, `readSaver`,
  `readMemoryFileSizes`, `writeSaver` ALL uncalled; propose mode →
  `writeSaver` never called, output contains `[apply]`/`[advice]` tags and
  the `--apply` footer; `--apply` → real temp-store write, re-read shows
  `enabled/balanced`, output contains `was:` and `now:`; nothing-appliable
  path; `--json` shape `{ plan, applied? }`; store errors → stderr + exit 1.
- `pnpm verify` green. E2E smoke: test key → activate → `mega savings fix`
  prints a plan; `--apply` flips the saver record (verify with
  `mega session saver status` or a store read); free user → upsell.

## Non-goals (deferred)

Undo/backup infra; auto-`aggressive`; real memory-file compression
(prose-compressor module); enforcing tool blocks or writing
`ToolDefinition`s; configurable thresholds; per-project fix plans; GUI
surface; windowed (monthly) analysis — the plan reads all recorded events,
mirroring insights.

## Slices

- **A**: `pro-analytics` pure engine (`computeFixPlan` + threshold consts) — TDD.
- **B**: gated `mega savings fix` (propose mode only: render + gate + spies) — TDD.
- **C**: `--apply` path (lock + write + was/now + `--json` applied) +
  register + README + changeset — TDD.
