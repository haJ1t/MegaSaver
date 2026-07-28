---
title: GUI Console Redesign — plan
spec: docs/superpowers/specs/2026-07-28-gui-console-redesign-design.md
risk: MEDIUM
created: 2026-07-28
---

# Plan

Frontend-only. Order is chosen so the token/shell foundation lands before
the pages that consume it, and so each step leaves the suite green.

## Step 1 — Token system + theme

- Restructure `src/styles/tokens.css`: `:root` light, `[data-theme="dark"]`
  override, `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])`.
- Retune values to the prototype palette **with the §3a corrections**
  (light `--ink-3` `#6a645a`, dark `--ink-3` `#868a93`, light `--accent` `#a84d07`).
- Add `--color-line-soft` and `--color-shadow`.
- Extend `tailwind.config.js`: `line-soft`, `shadow-md`, serif family,
  radii `xl`/`2xl`, the font stacks.
- **Test first:** rewrite `test/styles/accent-contrast.test.ts` to select
  blocks by selector (not `indexOf("@media")`) and assert every text role
  (`ink`, `ink-2`, `ink-3`, `accent`, `ok`, `warn`, `danger`) ≥4.5:1 against
  background, surface, raised, and its own soft fill, in both themes.

## Step 2 — View enum

- Add `"overview"` to `VIEW_IDS` (alphabetic), `VIEW_LABELS`.
- Update `test/view-id.test-d.ts`.

## Step 3 — App shell

- `components/sidebar.tsx`: grouped nav (Monitor / Optimize / Configure),
  active pill + left rail bar, session count, setup-attention dot, daemon
  footer, theme toggle.
- `components/theme-toggle.tsx` + `lib/theme.ts` (resolve OS, persist override).
- `components/top-bar.tsx`: workspace switcher, palette trigger, live count.
- `components/command-palette.tsx`: ⌘K, filter, `role="dialog"`, Escape.
- `components/toast.tsx` + a `useToast` hook, `role="status"`.
- `app.tsx` composes shell + routes `overview`.
- **Tests:** sidebar groups/active state, palette open/filter/escape,
  theme toggle override, toast auto-dismiss.

## Step 4 — Overview page (new)

- `views/overview-page.tsx`.
- Headline from `fetchAllWorkspaceTotals` → `computeSavingsHeadline`.
- Readiness: 5 checks from the 5 existing status routes, ready-count bar,
  "Build index" fix action routing to Workspace.
- Live-now list from `fetchClaudeSessions`.
- **Omit** sparkline + recent-activity per spec §4.
- **Tests:** headline formatting, readiness count/degradation on fetch
  failure, live filter.

## Step 5 — Restyle existing pages

Visual only; data wiring already exists. In order:
Sessions → Cockpit → Token saver → Workspace → Memory → Setup → Agent office.

- Token saver: three numbered switch cards + segmented mode + daemon row.
- Workspace: 4-tab strip.
- Memory: notes / graph / decision-trace, **no Live brain**.
- Agent office: floor-plan stage from the real roster (single floor),
  desk illustration, selection detail pane, list view.
- Cockpit: tab strip + right rail.

## Step 6 — Verify

- `pnpm verify` (biome + tsc + vitest) green.
- Smoke: `pnpm --filter @megasaver/gui dev`, drive the real app, screenshot
  each of the 7 pages in both themes.
- `code-reviewer` in a fresh context.
- Update `wiki/entities/gui.md` + `wiki/log.md`.

## Out of scope

The four omitted surfaces in spec §4 and every bridge/Core change.
