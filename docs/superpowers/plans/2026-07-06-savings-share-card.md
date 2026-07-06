# Savings share card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Strict TDD: failing test first → red → minimal impl → green → commit. Build after src edits. `pnpm verify` at slice boundaries.

**Goal:** MegaSaver generates its own shareable savings image — a **Share** button on the GUI renders a minimal-editorial (direction B) card from the savings-headline data, exportable to PNG + an X tweet-intent.

**Architecture:** A pure `renderSavingsCardSvg(headline, {windowLabel})` (SVG string, in the browser-safe `@megasaver/stats/headline`) reused by the GUI (and a future `mega share`). The GUI previews it + exports PNG via canvas (zero dep).

**Tech Stack:** TypeScript ESM, Vitest, React (GUI), SVG + canvas. Packages: `@megasaver/stats`, `apps/gui`.

**Spec:** `docs/superpowers/specs/2026-07-06-savings-share-card-design.md`. Risk MEDIUM → code-reviewer + critic. Direction B; GUI Share → PNG.

**Anchors:** `packages/stats/src/savings-headline.ts` (`SavingsHeadline`, `computeSavingsHeadline`, `SAVINGS_FOOTNOTE`, `INPUT_PRICE_PER_MTOK_USD`); `packages/stats/src/headline.ts` (browser-safe subpath barrel the GUI imports); `apps/gui/src/views/workspace-session-list.tsx` (`SavingsHeadlineStrip`, `savingsTotals`); the GUI's modal/dialog pattern (grep for an existing modal component to mirror).

---

## Slice A — `renderSavingsCardSvg` (pure, direction B)

**Files:** `packages/stats/src/savings-card.ts` (new); export from `savings-headline.ts`/`headline.ts` barrels; Test `packages/stats/test/savings-card.test.ts`.

- [ ] **Step 1: Test (RED)** — `renderSavingsCardSvg(headline, {windowLabel:"this week"})` where headline = `{tokensSaved:4_100_000, dollarsSaved:12.4, contextWindowsReclaimed:20.5, savingRatio:0.68, isEstimate:true}` → the returned string: starts with `<svg`, contains `width="1200"` `height="630"`, `$12.40`, `(est.)`, `this week`, a token count rendered (e.g. `4.1M` or `4100000`), `68%`, `20.5`, `Mega Saver`, `Less tokens. More signal.`; and parses via `DOMParser`/a validator without error (or a regex check that tags balance). Deterministic: two calls with the same input are byte-identical.
- [ ] **Step 2: Run → FAIL** (module missing).
- [ ] **Step 3: Implement** — a template-string SVG builder: 1200×630, bg `#f6f5f2`, text `#17181a`; a `<rect>` ground, the "Mega Saver" mark + a 22px square dot `#17181a`, the big `$` (system sans, ~150px, weight 800, letter-spacing tight), the `saved <windowLabel> (est.)` line, a row of 3 sub-stats (tokens saved / reduction % / sessions' worth), footer "Less tokens. More signal." Numbers formatted at the render layer (tokens → compact `X.YM`/`X.Yk`; `savingRatio*100 |> round` %; `contextWindowsReclaimed.toFixed(1)`; `$dollarsSaved.toFixed(2)`). Escape any text into SVG (`&`, `<`). No Date/random.
- [ ] **Step 4: Run → PASS.** Build + `pnpm --filter @megasaver/stats test`. Commit `feat(stats): render savings share card SVG (direction B)`.

## Slice B — GUI Share button + card modal + export

**Files:** `apps/gui/src/views/cockpit/` (or beside the strip) a new `savings-share-modal.tsx` + a Share button in `workspace-session-list.tsx`; `apps/gui/src/lib/` a small `card-export.ts` (svg→png blob); Tests: component test + the export helper test.

- [ ] **Step 1: Test (RED)** — (a) `workspace-session-list` renders a **Share** button ONLY when `savingsTotals.bytesSavedTotal > 0`; clicking opens the modal containing the card (the SVG). (b) The modal has Download PNG / Copy / Share-on-X actions; Share-on-X calls the injected `openUrl` with a `twitter.com/intent/tweet?text=` URL whose decoded text contains `$` + `(est.)` (honest). (c) `svgToPngBlob(svg)` (card-export.ts) resolves a Blob (mock `Image`/`canvas`/`toBlob`). (d) no savings → no Share button.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — `card-export.ts`: `svgToPngBlob(svg): Promise<Blob>` — `new Image()` src = `data:image/svg+xml;base64,<btoa(svg)>` → draw onto a 1200×630 `<canvas>` → `canvas.toBlob(png)`. `downloadBlob(blob, name)` + best-effort `copyBlob(blob)` (`navigator.clipboard.write([new ClipboardItem({'image/png':blob})])`, guarded). `savings-share-modal.tsx`: compute `renderSavingsCardSvg(computeSavingsHeadline(totals), {windowLabel})`, show it inline, wire the three actions; the X-intent text is honest + `(est.)`-carrying; a one-line note that the user downloads the card then attaches it (X can't auto-attach). Share button in the strip gated on savings > 0.
- [ ] **Step 4: Run → PASS.** Build + `pnpm --filter @megasaver/gui test`. Commit `feat(gui): share savings card — PNG + X intent`.

## Final gate
- `pnpm verify` green. **Real visual check:** build the GUI, open it (a seeded store with savings), click Share → confirm the card matches direction B (light editorial) and looks premium, the PNG downloads, the X-intent opens with honest text. Capture a screenshot.
- Changeset: `@megasaver/stats` minor, `@megasaver/gui` minor.
- code-reviewer + critic. Critic focus: the shared claim is HONEST — card + PNG + tweet text all carry `(est.)`, no overstatement, numbers match the headline exactly (reuse `computeSavingsHeadline`, one source), SVG text is escaped (no injection from a weird workspace name), export path degrades gracefully (no clipboard → hidden), Share hidden at zero savings.

## Deferred
`mega share` CLI; the other card directions; editable text; auto-attach image to X.
