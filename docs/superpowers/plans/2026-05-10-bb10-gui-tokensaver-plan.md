---
title: BB10 — GUI TokenSaverPanel + bridge routes — implementation plan
date: 2026-05-10
risk: MEDIUM
parent: 2026-05-10-aa1-context-gate-epic
spec: 2026-05-10-bb10-gui-tokensaver-design
sub-pr: BB10
status: draft
---

# BB10 implementation plan (tests-first)

Worktree root: `/Users/halitozger/Desktop/MegaSaver/.worktrees/bb10-gui-tokensaver`.
Run every verify gate from the worktree root. TDD: each task writes
the failing test(s) first, then the minimum code to pass. Commit per
logical task, Conventional Commits, subject ≤ 50 chars, trailer
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## File map

### New files

| Path | Responsibility |
|------|----------------|
| `apps/gui/bridge/routes/token-saver.ts` | 7 token-saver routes + private `readEvents` |
| `apps/gui/src/components/token-saver-panel.tsx` | per-session panel (fetch + enable/disable + events) |
| `apps/gui/src/components/token-saver-modal.tsx` | focus-trapped enable-options dialog |
| `apps/gui/src/components/token-saver-stats.tsx` | pure stats summary renderer |
| `apps/gui/src/components/savings-badge.tsx` | pure compact savings pill |
| `apps/gui/test/bridge/token-saver-routes.test.ts` | route happy/edge paths |
| `apps/gui/test/components/token-saver-panel.test.tsx` | panel behaviour |
| `apps/gui/test/components/token-saver-modal.test.tsx` | modal behaviour + a11y |
| `apps/gui/test/components/token-saver-stats.test.tsx` | stats render incl. null |
| `apps/gui/test/components/savings-badge.test.tsx` | badge enabled/hidden |
| `apps/gui/test/integration/token-saver-roundtrip.test.tsx` | enable→stats→disable flow |

### Extended files

| Path | Change |
|------|--------|
| `apps/gui/bridge/route-context.ts` | add `storeRoot: string` |
| `apps/gui/bridge/handler.ts` | set `ctx.storeRoot`; add `sendText`; register token-saver path regex (stay ≤ 200 LOC) |
| `apps/gui/bridge/zod-schemas.ts` | add `ENABLE_TOKEN_SAVER_BODY`, `DISABLE_TOKEN_SAVER_BODY` |
| `apps/gui/src/bridge-error-code.ts` | add `event_not_found` + copy |
| `apps/gui/src/lib/api-client.ts` | 5 fns + 2 URL builders + 2 types |
| `apps/gui/src/views/sessions-detail.tsx` | embed `TokenSaverPanel`; thread `onSettingsChanged` |
| `apps/gui/src/views/sessions-view.tsx` | wire panel callback to update row; pass to list |
| `apps/gui/src/views/sessions-list.tsx` | render `SavingsBadge` per row |
| `apps/gui/test/bridge/test-helpers.ts` | optional `storePath` + tokenSaver/stats/chunkSet seeds |
| `apps/gui/test/bridge-error-code.test-d.ts` | extend exhaustive assertion |
| `apps/gui/package.json` | add `@megasaver/stats`, `@megasaver/content-store` deps (if not already present) |

## Tasks

### T0 — Wiring prerequisites

- [ ] Confirm `apps/gui/package.json` depends on `@megasaver/stats`
      and `@megasaver/content-store` (workspace protocol); add if
      missing. `pnpm install`.
- [ ] **Test first:** extend `test/bridge/test-helpers.ts` is not a
      test — but add the seed helpers (`storePath` via `mkdtemp`,
      `tokenSaver` settings seed, `seedStats`, `seedChunkSet`) so
      route tests can arrange fixtures. Verify the existing handler
      tests still pass unchanged: `pnpm --filter @megasaver/gui test`.
- [ ] Add `storeRoot: string` to `RouteContext`
      (`route-context.ts`); set `ctx.storeRoot = storePath` in
      `handler.ts`. Verify typecheck:
      `pnpm --filter @megasaver/gui typecheck`.

### T1 — bridge-error-code: `event_not_found`

- [ ] **Test first:** extend `test/bridge-error-code.test-d.ts` to
      assert `event_not_found` is a member; assert `BRIDGE_ERROR_COPY`
      is exhaustive. Run test-d: fails.
- [ ] Insert `event_not_found` alphabetically into
      `BRIDGE_ERROR_CODES` + add copy. Verify:
      `pnpm --filter @megasaver/gui typecheck`.

### T2 — Zod bodies

- [ ] **Test first:** in `token-saver-routes.test.ts` add cases
      asserting enable rejects unknown keys / negative
      `maxReturnedBytes` (400 `validation_failed`) and accepts empty
      body. (Red — route not yet implemented.)
- [ ] Add `ENABLE_TOKEN_SAVER_BODY`, `DISABLE_TOKEN_SAVER_BODY` to
      `zod-schemas.ts`.

### T3 — Routes: enable / disable / status / stats

- [ ] **Test first** (`token-saver-routes.test.ts`):
  - enable on pre-AA session → 200, `tokenSaver.enabled === true`,
    defaults applied, `createdAt === updatedAt` first time.
  - enable with partial body overrides only provided fields,
    preserves `createdAt` on re-enable.
  - enable on bad `:id` → 404 `session_not_found`.
  - disable on enabled session → 200 `enabled: false`; summary
    zeroed (assert via stats route); events JSONL kept.
  - disable on pre-AA session → 200 unchanged (idempotent).
  - status: pre-AA → `{ enabled: false, settings: null }`;
    enabled → settings echoed.
  - stats: no summary file → 200 JSON `null`; with seeded summary →
    200 the summary object; corrupt summary → 500 `internal_error`.
- [ ] Implement routes 1–4 in `token-saver.ts`; register the path
      regex in `handler.ts`. Build `StatsStore` from `ctx.storeRoot`.
- [ ] Verify: `pnpm --filter @megasaver/gui test -- token-saver-routes`.

### T4 — Routes: events + events/:eventId/{raw,sent}

- [ ] **Test first** (`token-saver-routes.test.ts`):
  - events: missing JSONL → 200 `[]`; seeded multi-line → 200
    array newest-first; trailing partial last line tolerated;
    non-final malformed line → 500.
  - `/raw` + `/sent`: seeded event with chunkSet → 200
    `text/plain; charset=utf-8`, `content-disposition: inline`,
    CSP `default-src 'self'`, body == concatenated chunk text.
  - event with no `chunkSetId` → 404 `event_not_found`.
  - unknown event id → 404 `event_not_found`.
  - `loadChunkSet` not_found → 404 `event_not_found` (not 500).
- [ ] Implement private `readEvents` (JSONL parse, partial-last-line
      tolerance), routes 5–7, and `sendText` in `handler.ts`.
- [ ] Verify route suite green.

### T5 — api-client

- [ ] **Test first:** none new at unit level beyond type usage; the
      integration test (T9) exercises these. Add the 5 functions +
      2 URL builders + 2 exported types to `api-client.ts`.
- [ ] Verify typecheck.

### T6 — `savings-badge.tsx` (design chain first)

- [ ] Design chain checkpoint: `huashu-design` → `taste-skill` →
      `impeccable` for the badge (separate context lane).
- [ ] **Test first** (`savings-badge.test.tsx`): renders `null` when
      `tokenSaver.enabled !== true`; renders `N% saved` when ratio
      present; renders `on` when enabled but ratio undefined; has an
      `aria-label`.
- [ ] Implement using `badges.tsx` `BASE` idiom + tokens.css classes.
- [ ] Embed in `sessions-list.tsx` rows. Verify component suite.

### T7 — `token-saver-stats.tsx`

- [ ] Design chain checkpoint (as T6).
- [ ] **Test first** (`token-saver-stats.test.tsx`): `null` → "No
      activity yet."; full summary → renders each metric; ratio
      formatted as integer %.
- [ ] Implement pure component (local `StatField`).

### T8 — `token-saver-modal.tsx` + `token-saver-panel.tsx`

- [ ] Design chain checkpoint for panel + modal (`huashu-design` →
      `taste-skill` → `impeccable`, separate lane).
- [ ] **Test first** (`token-saver-modal.test.tsx`):
      `role="dialog" aria-modal="true"`; Esc closes; focus returns to
      trigger; submit calls handler with chosen partial body;
      defaults shown match `defaultTokenSaverSettings`.
- [ ] **Test first** (`token-saver-panel.test.tsx`):
      `settings: null` → enable CTA; enable click → calls
      `enableTokenSaver`, then re-fetches status/stats, fires
      `onSettingsChanged`; enabled → shows stats + events list +
      disable button; disable click → calls `disableTokenSaver`;
      bridge error → `ErrorState` with focus management;
      `/raw` + `/sent` rendered as anchor `href`s.
- [ ] Implement modal, then panel (mirror `SessionsView` load
      lifecycle). Verify component suites.

### T9 — Detail/view integration + roundtrip

- [ ] **Test first** (`integration/token-saver-roundtrip.test.tsx`):
      mount `SessionsView` against a test bridge with a seeded
      session; select it; enable via panel; assert stats render
      (null/zeroed); seed a stats event + chunkSet on disk; refresh;
      assert non-zero stats + event row + working raw/sent links;
      disable; assert zeroed summary + badge state.
- [ ] Embed `TokenSaverPanel` in `sessions-detail.tsx`; thread
      `onSettingsChanged` up through `sessions-view.tsx` to update the
      session row (feeds `SavingsBadge`).
- [ ] Verify integration suite + full GUI suite.

### T10 — DoD gate

- [ ] `pnpm verify` green from worktree root (lint + typecheck +
      test).
- [ ] Capture feature smoke evidence (route curls / component test
      output).
- [ ] `design:design-critique` + `design:accessibility-review` pass
      in a fresh context (epic §6d).
- [ ] `code-reviewer` pass in a separate context (epic §16
      LOW/MEDIUM).
- [ ] `verifier` pass in a separate context; record architect /
      critic / code-reviewer session UUIDs in the evidence bundle
      (epic §16 author/reviewer collision rule).
- [ ] Changeset added (`apps/gui` public surface changed: new bridge
      routes + components).
- [ ] Zero pending TodoWrite items.

## Verify commands

```bash
pnpm --filter @megasaver/gui test
pnpm --filter @megasaver/gui typecheck
pnpm verify          # full DoD gate, run from worktree root
```

## Out of scope (BB11)

`/api/mcp/*` routes, `agent-setup-doctor.tsx`, `agent-setup-row.tsx`,
connector CONTEXT_GATE block. No `mega output exec` invocation from
the GUI.
