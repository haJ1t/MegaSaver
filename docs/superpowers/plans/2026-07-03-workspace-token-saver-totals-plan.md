# Workspace Token-Saver Totals — Implementation Plan

> superpowers:subagent-driven-development. Strict TDD: failing test → red → minimal impl → green → commit. `pnpm build` after src edits. `pnpm verify` at task boundaries. Filters: `@megasaver/stats`, `@megasaver/gui`.

**Spec:** `docs/superpowers/specs/2026-07-03-workspace-token-saver-totals-design.md`
**Branch:** `fix/gui-workspace-token-saver-totals` (off main). Risk MEDIUM.

## Task 1 — `readWorkspaceTokenSaverTotals` (`@megasaver/stats`)

**Files:** `packages/stats/src/store.ts` (+ export in `src/index.ts`), `packages/stats/test/…`.

- Read `overlaySummaryPath` (store.ts:156), `readOverlaySummary`/`loadOverlaySummary` (:238), and the `OverlaySessionTokenSaverStats` schema first to reuse the exact load+validate path and field set.
- Signature: `export function readWorkspaceTokenSaverTotals(store: StatsStore, workspaceKey: string): WorkspaceTokenSaverTotals | null` (define + export the `WorkspaceTokenSaverTotals` type per spec).
- Impl: resolve `<root>/stats/<workspaceKey>/`; `readdirSync` (try/catch → null on ENOENT); for each entry ending `.json`, attempt to load+parse it as an overlay summary (reuse `loadOverlaySummary` or the summary schema `.safeParse`); keep only successes (this drops `*.settings.json`, `workspace-token-saver.json`, `session-intent.json` — none parse as a summary). Sum eventsTotal/rawBytesTotal/returnedBytesTotal/bytesSavedTotal/secretsRedactedTotal/chunksStoredTotal; `sessionsCount` = number of valid summaries; `savingRatio` = rawBytesTotal===0 ? 0 : bytesSavedTotal/rawBytesTotal; `latestUpdatedAt` = max updatedAt (string compare on ISO) or null. Return null if zero valid summaries.
- Tests (TDD, write first): mkdtemp store, write 3 valid `<uuid>.json` summaries + one `<uuid>.settings.json` + a `workspace-token-saver.json` under `stats/<wk>/`; assert totals sum ONLY the 3 (sessionsCount 3, byte sums exact, ratio, latestUpdatedAt = max); missing dir → null; empty dir → null; one corrupt `<uuid>.json` (invalid) skipped, others still summed. Mirror existing stats overlay test fixtures.
- Commit: `feat(stats): aggregate token-saver totals across a workspace`.

## Task 2 — bridge route + client

**Files:** `apps/gui/bridge/routes/claude-session-token-saver.ts` (new handler), the bridge route table (find where `/token-saver/stats` is registered — `apps/gui/bridge/handler.ts` per `git grep`), `apps/gui/src/lib/claude-sessions-client.ts` (new fetch fn + type), tests in `apps/gui/test/bridge/`.

- Handler `handleWorkspaceTokenSaverStats(ctx, dir, id)`: mirror `handleWorkspaceSaverStatus`'s shape — `resolveSessionWorkspace` to get `workspaceKey` (send resolve error via `sendSessionResolveError` on failure), then `readWorkspaceTokenSaverTotals({ root: ctx.storeRoot }, resolved.workspaceKey)`, `ctx.res`-send JSON (null when none). Read the existing `handleSessionTokenSaverStats` handler in this file to copy its response/error plumbing exactly.
- Register route `GET .../token-saver/workspace-stats` next to `.../token-saver/stats` in the route table.
- Client: `export function fetchWorkspaceTokenSaverStats(dir, id): Promise<WorkspaceTokenSaverTotals | null>` → `getJson(`${tokenSaverBase(dir,id)}/workspace-stats`)`; export the `WorkspaceTokenSaverTotals` type (import from `@megasaver/stats` if the GUI depends on it, else mirror the shape).
- Tests: bridge test (mirror the existing token-saver stats bridge test in `apps/gui/test/bridge/`) — a store with summaries → route returns the summed totals; none → null; wk resolved from dir.
- Commit: `feat(gui): bridge + client for workspace token-saver totals`.

## Task 3 — panel fallback + copy fix

**Files:** `apps/gui/src/views/cockpit/token-saver-panel.tsx`, tests (component test mirroring existing panel tests, or the bridge/integration test the repo uses for panels).

- Add a second fetch: when the per-session `stats` resolves to null, fetch `fetchWorkspaceTokenSaverStats(dir, id)` and hold it in state (or fetch both concurrently and prefer session when present).
- Render: `stats !== null` → existing session card (unchanged). `stats === null && workspaceTotals !== null` → a **workspace-total card** with a clear label like `workspace total (N sessions)` showing tokens/bytes saved + ratio (reuse `TokenSavedValue` style). `stats === null && workspaceTotals === null` → `"No token-saver activity in this workspace yet."` (replace the "No proxy activity" string).
- Keep the 2s poll for both. Preserve loading/error states.
- Tests: with a mocked/bridged null session + non-null workspace totals → the workspace card renders and the old empty string is absent; both null → the new empty string. Follow how existing panel tests inject bridge responses.
- Commit: `fix(gui): show workspace total when session token-saver is empty`.

## Final gate

- `pnpm verify` green (incl. GUI test typecheck now enforced).
- Real smoke: run the built bridge (`node --import tsx apps/gui/bridge/server.ts` with `MEGASAVER_GUI_BRIDGE_PORT`) OR unit-invoke the handler against `--store /Users/halitozger/.local/share/megasaver` for wk `e02b98f66e82b6b9` → confirm workspace-stats returns the multi-MB total (sessionsCount ≥ 8). Capture output.
- Changeset: `@megasaver/stats` minor, `@megasaver/gui` minor.
- code-reviewer + critic (fresh) over `main..HEAD`; then PR to main.

## Deferred
Always-show workspace total alongside session; conversation→id mapping; cross-workspace global total.
