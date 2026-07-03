# Audit Overlay Fallback — Implementation Plan

> superpowers:subagent-driven-development. Strict TDD: failing test first → red for the right reason → minimal impl → green → commit. `pnpm build` after src edits (vitest resolves @megasaver/* via dist). `pnpm verify` at task boundaries. CLI package filter = `@megasaver/cli`; stats = `@megasaver/stats`.

**Spec:** `docs/superpowers/specs/2026-07-03-audit-overlay-fallback-design.md`
**Branch:** `fix/audit-session-overlay-fallback` (off main). Risk MEDIUM.

## Task 1 — `readOverlaySummaryAnyWorkspace` helper

**Files:** `packages/stats/src/store.ts` (add fn + export via `src/index.ts` if it has an export list), `packages/stats/test/store.test.ts` (or a new test file mirroring existing overlay tests).

- Signature: `export function readOverlaySummaryAnyWorkspace(store: StoreRootInput, liveSessionId: string): { workspaceKey: string; summary: OverlaySessionTokenSaverStats } | null` — match the `store` param type the sibling `readOverlaySummary` uses (line 238).
- Impl: resolve the `stats/` dir (mirror how `overlaySummaryPath` builds paths); `readdirSync` the stats dir; for each entry that is a directory (a workspaceKey), call the existing `readOverlaySummary(store, wk, liveSessionId)`; collect matches; return the one with the **lexicographically smallest workspaceKey** (sort, take first) or `null`. Best-effort: wrap the readdir in try/catch → `null` on missing dir; a per-workspace read that throws/returns null is just skipped.
- Tests (TDD, write first, confirm red = fn missing): (a) two workspaces each with a summary for id X → returns the sorted-first workspaceKey's summary; (b) id present in exactly one workspace → returns it; (c) id in none → null; (d) no stats dir → null; (e) a workspace whose file is corrupt is skipped, a valid one still found. Mirror the fixture style in the existing stats overlay tests (write `stats/<wk>/<id>.json` files under a `mkdtemp` root).
- Commit: `feat(stats): find overlay summary across workspaces by session id`.

## Task 2 — `audit session` overlay fallback

**Files:** `apps/cli/src/commands/audit/session.ts`, `apps/cli/src/commands/audit/shared.ts` (add an overlay card formatter), tests in `apps/cli/test/audit/` (mirror the existing audit session test).

- In `runAuditSession`, at the `if (!session)` branch (currently `session.ts:43-47`), BEFORE emitting `sessionNotFoundMessage`, call `readOverlaySummaryAnyWorkspace({ root: rootDir }, parsedSessionId)` (match the store-input shape the helper expects; `rootDir` is already resolved). If it returns non-null:
  - `input.json` → `input.stdout(JSON.stringify(found.summary))`.
  - else → `for (const line of formatOverlaySaverCard(found.summary, found.workspaceKey)) input.stdout(line)`.
  - `return 0`.
  If null → keep the existing `sessionNotFoundMessage` path (unchanged exit code).
- `formatOverlaySaverCard(summary, workspaceKey): string[]` in `shared.ts`: a small card clearly labelled `live token-saver session (overlay stats)`, showing eventsTotal, rawBytesTotal→returnedBytesTotal, bytesSavedTotal, savingRatio (as %), chunksStoredTotal, secretsRedactedTotal, updatedAt, workspaceKey. Reuse existing card style/helpers in `shared.ts` for consistency.
- Tests (TDD): build a `mkdtemp` store containing ONLY an overlay summary at `stats/<wk>/<id>.json` (no registered session); run `runAuditSession` → exit 0, stdout contains the saved bytes/ratio and the "overlay" label, NOT "session not found". Add: registered session present → unchanged registered card (fallback not taken); neither → "session not found" + original exit code; `--json` → emits the overlay summary JSON. Mutation lock: the primary test must fail if the fallback block is removed.
- Commit: `feat(cli): audit session falls back to overlay stats`.

## Task 3 — `audit honest` overlay fallback

**Files:** `apps/cli/src/commands/audit/honest.ts`, tests.

- Read `honest.ts` first: it also resolves a session via `registry.getSession` (or reads registered audit/honest metrics). Apply the SAME fallback: on no registered session, render the overlay card (honest has no token-weighted overlay equivalent, so reuse `formatOverlaySaverCard` + a one-line note that honest token-weighted metrics need a registered/proxy session; overlay bytes are shown instead). `--json` emits the overlay summary. If `honest.ts` structure differs materially from `session.ts`, follow its real shape and report the adjustment.
- Tests mirror Task 2.
- Commit: `feat(cli): audit honest falls back to overlay stats`.

## Final gate

- `pnpm verify` green (incl. the now-enforced test typecheck).
- Manual smoke: run the built CLI `audit session <this live id> --store ~/.local/share/megasaver` → shows the overlay stats (5 events / 73KB / 81%) instead of "not found". Capture output.
- Changeset: `@megasaver/cli` minor, `@megasaver/stats` minor.
- code-reviewer + critic (fresh) over the diff; then PR to main.

## Deferred
`report` overlay support; cwd-derived workspaceKey; unified overlay+registered view.
