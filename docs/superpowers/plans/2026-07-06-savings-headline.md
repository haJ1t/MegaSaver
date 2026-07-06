# Savings headline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Strict TDD: failing test first → red → minimal impl → green → commit. Build after src edits (`pnpm --filter @megasaver/<pkg> build`). `pnpm verify` at slice boundaries.

**Goal:** Make the saved-tokens value VISIBLE as a cumulative `≈$X saved (est.) · ≈Z sessions' worth of context reclaimed` headline on the GUI home + `mega audit report`.

**Architecture:** One pure `computeSavingsHeadline` (token→$ + context-reclaimed) in `@megasaver/stats`, fed by an all-workspace totals aggregator; surfaced by the CLI report renderer and the GUI home strip. The price constant lives in one place, shared.

**Tech Stack:** TypeScript ESM, Vitest, Citty (CLI), React (GUI). Packages: `@megasaver/stats`, `apps/cli`, `apps/gui`.

**Spec:** `docs/superpowers/specs/2026-07-06-savings-headline-design.md`. Risk MEDIUM → code-reviewer + critic. Decisions: dual framing ($ + limit-headroom); fixed representative input price + "(est.)".

**Anchors:** `packages/stats/src/honest-metrics.ts` `tokensFromBytes(bytes)=ceil(bytes/4)`; `packages/stats/src/store.ts` `WorkspaceTokenSaverTotals { bytesSavedTotal, savingRatio, sessionsCount }` + `readWorkspaceTokenSaverTotals`; `packages/stats/src/index.ts` (exports); `apps/gui/bridge/routes/claude-session-token-saver.ts:239` (the existing per-workspace totals route to mirror); `apps/gui/src/views/workspace-session-list.tsx:~95` (home strip Workspaces/Sessions/Live); `apps/cli` audit report renderer (`mega audit report --window`).

---

## Slice A — core: headline fn + all-workspace aggregator (`@megasaver/stats`)

### Task A1: `computeSavingsHeadline`
- Create `packages/stats/src/savings-headline.ts`; export from `index.ts`; test `test/savings-headline.test.ts`.
- Consts: `INPUT_PRICE_PER_MTOK_USD = 3.0`, `CONTEXT_WINDOW_TOKENS = 200_000` (WHY comments per spec).
- `computeSavingsHeadline(totals, opts?)` → `{ tokensSaved, dollarsSaved, contextWindowsReclaimed, savingRatio, isEstimate: true }` per spec §1. Lossless (no rounding in the fn).
- TEST first (RED): totals `{bytesSavedTotal: 4_000_000, sessionsCount: 10, savingRatio: 0.4}` → tokensSaved = 1_000_000, dollarsSaved = 3.0 (at $3/M), contextWindowsReclaimed = 5, isEstimate true; a custom `inputPricePerMTok: 15` → dollarsSaved 15; zero totals → all zeros + isEstimate true. Mutation: dividing by 1_000 instead of 1_000_000, or using a different context const, breaks the asserted numbers.

### Task A2: `readAllWorkspaceTokenSaverTotals`
- Add to the module that owns `readWorkspaceTokenSaverTotals`; export from `index.ts`; test.
- `readAllWorkspaceTokenSaverTotals(store)` → `{ bytesSavedTotal, sessionsCount, savingRatio, workspaceCount }` summing every workspace's totals (iterate the workspace dirs; reuse `readWorkspaceTokenSaverTotals`; blended `savingRatio = sum(bytesSaved) / sum(rawBytes)` — if raw totals aren't retained, recompute from the per-ws ratio*bytes or store rawBytesTotal; check the store shape first). Best-effort: unreadable workspace skipped.
- TEST first: a stats store seeded with 3 workspaces → summed bytesSavedTotal + sessionsCount + workspaceCount=3; an unreadable/empty workspace skipped, rest intact.
- Build + `pnpm --filter @megasaver/stats test`; commit `feat(stats): savings headline + all-workspace totals`.

## Slice B — CLI: `mega audit report` headline

- Modify the audit report renderer (find it: `grep -rn "tokensSaved\|window" apps/cli/src/commands/audit/`); Test in the audit report test.
- Render, after the existing summary, a headline line: `Saved ≈<tokensSaved> tokens ≈ $<dollarsSaved.toFixed(2)> (est.) · ≈<contextWindowsReclaimed.toFixed(1)> sessions' worth of context (200K each).` + footnote `(est. at $3/M input; saved tokens were never sent, so not cache-discounted.)`. `--json` adds the SavingsHeadline object.
- TEST first: a fixture with known tokensSaved → the report text contains the $ + sessions line + footnote; `--json` carries the SavingsHeadline; zero savings → an honest line (no fake flex). Build + `pnpm --filter @megasaver/cli test`; commit `feat(cli): savings headline in audit report`.

## Slice C — GUI: home-strip headline

- Add a bridge route `GET /api/token-saver/all-workspaces` → `readAllWorkspaceTokenSaverTotals` (mirror the existing per-workspace route at claude-session-token-saver.ts:239; register in handler.ts). Client `fetchAllWorkspaceTotals()`. In `workspace-session-list.tsx`, fetch it, compute `computeSavingsHeadline` (import the pure fn — shared price const), render `≈$<Y> saved (est.) · ≈<Z> sessions reclaimed` beside the strip with a hover/footnote; empty → honest "No savings recorded yet — enable the saver to start."
- TEST first (bridge + component per the repo's harness): route returns the summed totals; the strip renders the headline when savings > 0 and the empty copy when 0. Build + `pnpm --filter @megasaver/gui test`; commit `feat(gui): savings headline on the home strip`.

## Final gate
- `pnpm verify` green. Real smoke: run a compressed read (saver on), then `mega audit report --window all` shows the $ headline; the GUI home strip shows it.
- Changeset: @megasaver/stats minor, @megasaver/cli minor, @megasaver/gui minor.
- code-reviewer + critic. Critic focus: honesty — the $ is labeled (est.), the context-window divisor is conservative (200K, under-counts sessions), the aggregation doesn't double-count, empty state is honest (no fake $0 flex), tokensFromBytes reused (one token model).

## Deferred
Weekly-digest push/scheduling; user-configurable model/price; proxy-usage real $.
