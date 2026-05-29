---
title: BB10 — GUI TokenSaverPanel + bridge routes
date: 2026-05-10
risk: MEDIUM
parent: 2026-05-10-aa1-context-gate-epic
sub-pr: BB10
depends-on: [BB1, BB2, BB4, BB5, BB6]
blocks: [BB11]
status: draft
---

# BB10 — GUI TokenSaverPanel + bridge routes

Child spec of AA1 (Context Gate / Mega Saver Mode). Authority is
the epic spec `docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md`;
this document scopes the GUI surface (§6, §6a–§6d) and the
token-saver bridge route half (§6c). Where this spec and the epic
disagree, the epic wins.

## 1. Goal & non-goals

### Goal

Surface Mega Saver Mode per-session in the existing React GUI:

- A `TokenSaverPanel` embedded in `sessions-detail.tsx` that lets
  the user enable/disable Mega Saver Mode for the selected session,
  shows live stats, and lists the stored token-saver events.
- A `SavingsBadge` shown on each row of the sessions list with a
  compact savings percentage.
- Seven loopback bridge routes under
  `/api/sessions/:id/token-saver/*` that read from `@megasaver/core`
  (settings via `updateTokenSaver`), `@megasaver/stats` (summary +
  events JSONL), and `@megasaver/content-store` (chunkSet raw/sent
  blobs).

### Non-goals

- No MCP routes (`/api/mcp/*`) — that is BB11.
- No `AgentSetupDoctor` view or `agent-setup-row` component — BB11.
- No connector CONTEXT_GATE block rendering — BB11.
- No `mega output exec` invocation from the GUI. The GUI never
  spawns child processes; it only reads what the CLI/MCP path has
  already persisted. CLI `output exec` runs (BB7b) write stats +
  chunkSets out-of-band; the panel reflects them on next refresh.
- No write path for individual events or chunkSets. The only
  mutating routes are enable/disable.
- No new top-level view. The existing `sessions-{list,detail,view}`
  trio is extended, never duplicated (epic §6a).

## 2. Dependencies (all satisfied on main)

| Dependency | Source | Used for |
|------------|--------|----------|
| `Session.tokenSaver?: TokenSaverSettings` | `@megasaver/core` (BB1, §4b) | panel state, enable/disable result |
| `CoreRegistry.updateTokenSaver(id, settings)` | `@megasaver/core` (BB1, §4d) | enable/disable write |
| `defaultTokenSaverSettings(now)` | `@megasaver/core/token-saver` (BB1) | enable defaults |
| `tokenSaverSettingsSchema` | `@megasaver/core` (BB1) | not re-validated client-side; bridge trusts core |
| `tokenSaverModeSchema` / `TokenSaverMode` | `@megasaver/shared` (BB1) | mode select options |
| `readSummary`, `appendEvent` types, `SessionTokenSaverStats`, `resetOnDisable`, `StatsStore` | `@megasaver/stats` (BB6, §13) | stats route, disable reset |
| `TokenSaverEvent`, `tokenSaverEventSchema` | `@megasaver/stats` (BB6, §13a) | events route, JSONL parse |
| `loadChunkSet`, `listChunkSets`, `ChunkSet`, `ChunkSetSummary`, `ContentStoreError` | `@megasaver/content-store` (BB4, §10b) | events/raw + events/sent routes |

`@megasaver/stats` exposes no per-event reader — only `readSummary`
(summary file) and the append path. The `events` route reads the
append-only JSONL log directly (epic §13b on-disk layout); a small
private reader `readEvents(store, projectId, sessionId)` is added to
`bridge/routes/token-saver.ts` (NOT to the stats package public
surface — bridge is a consumer, the file format is fixed by §13b).

## 3. Bridge routes (epic §6c — token-saver half)

All seven live in `apps/gui/bridge/routes/token-saver.ts`. They
follow the `sessions.ts` handler shape exactly: Zod-validated body
where a body exists, `RouteContext.sendJson`/`sendError`, errors
funnelled through `handleCaughtError` (`error-mapping.ts`), CORS by
`cors.ts`, registered in `handler.ts` behind a single path regex.

| # | Method | Path | Reads / writes | Success |
|---|--------|------|----------------|---------|
| 1 | POST | `/api/sessions/:id/token-saver/enable` | `registry.updateTokenSaver` | 200 `Session` |
| 2 | POST | `/api/sessions/:id/token-saver/disable` | `registry.updateTokenSaver` + `resetOnDisable` | 200 `Session` |
| 3 | GET | `/api/sessions/:id/token-saver/status` | `registry.getSession` | 200 `TokenSaverStatusResponse` |
| 4 | GET | `/api/sessions/:id/token-saver/stats` | `readSummary` | 200 `SessionTokenSaverStats \| null` |
| 5 | GET | `/api/sessions/:id/token-saver/events` | `readEvents` (JSONL) | 200 `TokenSaverEvent[]` |
| 6 | GET | `/api/sessions/:id/token-saver/events/:eventId/raw` | `loadChunkSet` | 200 `text/plain` blob |
| 7 | GET | `/api/sessions/:id/token-saver/events/:eventId/sent` | `loadChunkSet` | 200 `text/plain` blob |

### 3.1 RouteContext extension — `storeRoot`

`@megasaver/stats` and `@megasaver/content-store` are filesystem
packages keyed by a resolved store root. The bridge today only
hands `storePath` to the health route. BB10 threads the resolved
root into `RouteContext` as `storeRoot: string` so the token-saver
routes can construct `StatsStore` and call content-store readers.

- `route-context.ts`: add `storeRoot: string` to `RouteContext`.
- `handler.ts`: set `storeRoot: storePath` when building `ctx`
  (already captured as `opts.storePath`). Handler stays ≤ 200 LOC
  (epic §14 BB10 constraint) — the addition is one assignment plus
  one path regex block.
- `test-helpers.ts`: `startTestBridge` gains an optional
  `storePath` seed (defaults to a per-test `mkdtemp` dir) and seeds
  `tokenSaver` settings / stats files / chunkSets when provided.

This is additive: existing routes ignore `storeRoot`; the
non-token-saver tests are unaffected because the field is always a
string (empty default is never read by them).

### 3.2 Id validation

Every route validates `:id` with `sessionIdSchema.safeParse` and
returns `404 session_not_found` on failure, identical to
`handleEndSession`. Routes 6/7 additionally treat a missing
`:eventId` segment via the path regex (no match → 404
`route_not_found`).

### 3.3 Enable (route 1)

```
POST /api/sessions/:id/token-saver/enable
body: ENABLE_TOKEN_SAVER_BODY (Zod, optional fields)
```

- `ENABLE_TOKEN_SAVER_BODY` (new in `zod-schemas.ts`): `.strict()`,
  all fields optional —
  `mode?: tokenSaverModeSchema`,
  `maxReturnedBytes?: z.number().int().positive()`,
  `storeRawOutput?: z.boolean()`,
  `redactSecrets?: z.boolean()`,
  `autoRepair?: z.boolean()`.
  No body / empty body is valid (enable with defaults).
- The handler loads the existing session. If it has no
  `tokenSaver`, it starts from `defaultTokenSaverSettings(ctx.now)`;
  otherwise it starts from the existing settings (preserves
  `createdAt`). It overlays the provided fields, forces
  `enabled: true`, sets `updatedAt: ctx.now()`, then calls
  `registry.updateTokenSaver(id, next)`.
- Returns the full `Session` (200), matching the `endSession` /
  `patchSession` envelope. The panel re-derives state from
  `session.tokenSaver`.
- Core re-validates via `tokenSaverSettingsSchema.parse` inside
  `updateTokenSaver`; the bridge does NOT duplicate that validation
  (CLAUDE.md §8 — validate once at the boundary; core IS the
  boundary for the settings object). The bridge's Zod body only
  guards the partial user input shape.

### 3.4 Disable (route 2)

```
POST /api/sessions/:id/token-saver/disable
body: {} (no fields; .strict() empty object, empty body accepted)
```

- Loads the session. If `tokenSaver === undefined`, returns 200
  with the session unchanged (idempotent disable — never invents
  settings just to flip a flag off). Otherwise writes the existing
  settings with `enabled: false` and `updatedAt: ctx.now()`.
- Then calls `resetOnDisable(store, projectId, sessionId)` per epic
  §13c: events JSONL is kept, summary totals zeroed. `resetOnDisable`
  rewrites the summary file unconditionally; this is safe even when
  no prior summary existed (it writes a zeroed one). The route does
  NOT surface the reset result in the response body — the panel
  re-fetches `stats` after disable.
- Returns the updated `Session` (200).

### 3.5 Status (route 3)

```
GET /api/sessions/:id/token-saver/status
→ 200 { enabled: boolean; settings: TokenSaverSettings | null }
```

`settings` is `session.tokenSaver ?? null`; `enabled` is
`session.tokenSaver?.enabled === true`. A pre-AA session
(`tokenSaver === undefined`) returns `{ enabled: false, settings: null }`
honestly — no fabricated defaults (epic §4c: panel renders the
"Enable Mega Saver Mode" CTA on `settings: null`).

### 3.6 Stats (route 4)

```
GET /api/sessions/:id/token-saver/stats
→ 200 SessionTokenSaverStats | null
```

`readSummary(store, projectId, sessionId)` returns `null` when no
summary file exists. The route returns that `null` verbatim (200,
JSON `null`). No fake zeroed object is synthesised — absence of a
summary is reported honestly (epic events note). The panel renders
"no activity yet" on `null`. `readSummary` throws
`StatsError("store_corrupt")` on a malformed file; that surfaces as
`500 internal_error` via `handleCaughtError` (see §3.9).

### 3.7 Events (route 5)

```
GET /api/sessions/:id/token-saver/events
→ 200 TokenSaverEvent[]
```

- Reads `<store>/stats/<projectId>/<sessionId>.events.jsonl` via a
  private `readEvents` helper. Missing file → `[]` (empty, honest;
  no events yet). Each non-empty line is parsed with
  `tokenSaverEventSchema.parse`. A trailing partial line (crash
  during append, §13b) is tolerated only as the LAST line and only
  when JSON-incomplete; any non-final malformed line is a corrupt
  store → `500 internal_error`.
- Returned newest-first (`createdAt` descending) to match the
  list/detail sort convention (`sessions.ts` startedAt-desc).

### 3.8 Event raw / sent blobs (routes 6, 7)

The epic (§6c) routes these by `:eventId`, but the underlying blob
is a chunkSet keyed by `chunkSetId`. The mapping: the route reads
the event by id from the JSONL log, takes its `chunkSetId`, then
loads the chunkSet.

- 404 `route_not_found` is reserved for shape; a known-shaped but
  unknown event id returns 404 `session_not_found`? No — a new
  bridge error code is needed. **Decision:** reuse the existing
  envelope with code `route_not_found` would mislead. BB10 adds one
  bridge error code `event_not_found` (alphabetic insert in
  `BRIDGE_ERROR_CODES` between `validation_failed`-region; exact
  position: after `chunk... ` — see §5). It maps to 404. An event
  whose `chunkSetId` is absent (storeRawOutput was false) returns
  404 `event_not_found` with message "Event has no stored output."
- `/raw` serves the reconstructed raw output: the chunkSet's
  `chunks[].text` concatenated in order (this is the stored raw
  excerpt set; content-store holds the post-filter chunked text per
  §10d). `/sent` serves the same chunkSet content that was returned
  to the agent. **Honest-data rule:** when no chunkSet exists for
  the event (no `chunkSetId`, or `loadChunkSet` throws
  `ContentStoreError("not_found")`), the route returns 404
  `event_not_found`, never an empty 200 blob and never fabricated
  text.
- Both endpoints set `content-type: text/plain; charset=utf-8`,
  `content-disposition: inline`, and preserve
  `content-security-policy: default-src 'self'` (epic §6c,
  `handler.ts:50` precedent). A dedicated `sendText` writer is added
  to `handler.ts` mirroring `sendJson` (same CSP + CORS headers,
  text body). Routes 6/7 are the only non-JSON responders.

> NOTE on raw vs sent divergence: in v0.4 the content-store holds a
> single chunkSet per event (the filtered/chunked text). `/raw` and
> `/sent` therefore currently serve the SAME bytes — both are the
> stored chunkSet text. This is intentional and honest: there is no
> separate "raw original" persisted blob in BB4's content-store
> (only the chunked text is stored, §10d). The two URLs are kept
> distinct per epic §6c so a later revision that persists the
> pre-chunk raw can diverge them without a route change. BB10 does
> NOT fabricate a different "raw" payload to make them differ.

### 3.9 Error mapping

No change to `error-mapping.ts` behaviour beyond the new code.
`ContentStoreError` and `StatsError` are not `CoreRegistryError` /
`CorePersistenceError`, so they fall through to the
`Error`-with-`code` heuristic. To avoid an `Exxx`-prefixed FS-style
misclassification, the token-saver routes catch
`ContentStoreError("not_found")` explicitly and translate it to
`event_not_found` BEFORE delegating to `handleCaughtError`; all
other thrown errors (corrupt store, schema invalid) go to
`handleCaughtError` → `500 internal_error`. `error-mapping.ts` is
NOT extended with stats/content-store branches — keeping the map
focused on core errors (the routes own their domain translation).

## 4. React components (epic §6b)

Four new files under `apps/gui/src/components/`, each one
responsibility, ≤ 300 LOC, kebab-case.

### 4.1 `token-saver-panel.tsx`

Embedded in `sessions-detail.tsx` for the selected session. Owns
the panel's own fetch lifecycle (status + stats) keyed by
`session.id`, mirroring `SessionsView`'s load pattern
(`useCallback` + `useEffect`, `loading|ready|error` state,
`ErrorState`/`LoadingState` from `states.tsx`).

- On `settings === null` (or `enabled: false` and no settings):
  renders an "Enable Mega Saver Mode" CTA + a `TokenSaverModal`
  trigger for choosing mode/options before enabling.
- On `enabled: true`: renders current mode + a `TokenSaverStats`
  block + an events list (chunkSet links to `/raw` and `/sent` via
  anchor `href`, opened inline — the browser streams the blob) + a
  "Disable" button.
- Enable/disable call the api-client functions (§6) and on success
  call an `onSettingsChanged(session)` prop so `SessionsView` can
  update the row (the returned `Session` carries fresh
  `tokenSaver`, which feeds `SavingsBadge`). The panel then
  re-fetches stats.
- Accessibility: panel is a `<section aria-label="Mega Saver Mode">`;
  toggle buttons carry explicit `aria-pressed` / labels; error
  region focus-managed exactly like `SessionsView.errorRef`.

### 4.2 `token-saver-modal.tsx`

Triggered from the panel. A focus-trapped dialog
(`role="dialog" aria-modal="true"`, Esc closes, focus restored to
the trigger on close) for choosing `mode` (select over
`TokenSaverMode` members), `maxReturnedBytes`, and the three
booleans (`storeRawOutput`, `redactSecrets`, `autoRepair`) before
enabling. Submitting calls the panel's enable handler with the
chosen partial body. Defaults shown mirror
`defaultTokenSaverSettings` (balanced / 12_000 / all true). Pure
presentation + local form state; no fetch of its own.

### 4.3 `token-saver-stats.tsx`

Pure component. Props: `SessionTokenSaverStats | null`. Renders the
summary metrics (events total, bytes saved, saving ratio as %,
secrets redacted, chunks stored, updatedAt). On `null` renders
"No activity yet." Uses the existing `Field`-style dl layout idiom
from `sessions-detail.tsx` (a local `StatField` — the existing
`Field` is not exported; a 3-line local is preferred over exporting
and coupling per CLAUDE.md §8 anti-abstraction).

### 4.4 `savings-badge.tsx`

Pure component. Props:
`{ tokenSaver?: TokenSaverSettings; savingRatio?: number }`.
Renders nothing (returns `null`) when `tokenSaver?.enabled !== true`
— a disabled/absent-mode session shows no badge (epic §6b "compact
savings %"). When enabled, renders a pill using the shared `BASE`
class idiom from `badges.tsx` showing `N% saved` (rounded
`savingRatio * 100`) or `on` when no ratio is known yet. Embedded
in `sessions-list.tsx` rows.

`savingRatio` for the list badge comes from the session list itself:
BB10 does NOT fetch per-session stats for every list row (that would
be N requests). The badge shows enabled-state from
`session.tokenSaver` and an optional ratio only when already
available (the detail panel's fetched stats are not propagated to
the list in BB10; the list badge therefore shows `on` until a
session is selected). This keeps the list render O(1) per row and
honest — no fabricated percentage.

## 5. Closed-enum / surface deltas

- `apps/gui/src/bridge-error-code.ts`: add `event_not_found`
  (alphabetic: after `chunk`-region — concretely between
  `... ` existing members, inserted to preserve AA3 alphabetic
  order, i.e. after the entries that sort before `event_not_found`).
  Update `BRIDGE_ERROR_COPY` with a human string ("Event not found,
  or it has no stored output."). Update the `.test-d.ts` exhaustive
  assertion (`apps/gui/test/bridge-error-code.test-d.ts`).
- `apps/gui/bridge/zod-schemas.ts`: add `ENABLE_TOKEN_SAVER_BODY`
  and `DISABLE_TOKEN_SAVER_BODY`.
- `apps/gui/bridge/route-context.ts`: add `storeRoot: string`.
- `apps/gui/src/lib/api-client.ts`: add the seven client functions
  (§6).
- No change to `cors.ts` (GET/POST already allowed).
- No change to `write-action.ts` (token-saver toggles are not part
  of the form-state reducer's create/end/update flows; the panel
  owns its own enable/disable state). If review finds the panel
  needs reducer integration, that is a follow-up — not assumed here.

## 6. api-client additions

```ts
export type TokenSaverStatusResponse = {
  enabled: boolean;
  settings: TokenSaverSettings | null;
};
export type EnableTokenSaverBody = {
  mode?: string;
  maxReturnedBytes?: number;
  storeRawOutput?: boolean;
  redactSecrets?: boolean;
  autoRepair?: boolean;
};

enableTokenSaver(id, body?): Promise<Session>      // POST .../enable
disableTokenSaver(id): Promise<Session>            // POST .../disable
fetchTokenSaverStatus(id): Promise<TokenSaverStatusResponse>
fetchTokenSaverStats(id): Promise<SessionTokenSaverStats | null>
fetchTokenSaverEvents(id): Promise<TokenSaverEvent[]>
tokenSaverEventRawUrl(id, eventId): string         // href, not fetch
tokenSaverEventSentUrl(id, eventId): string        // href, not fetch
```

Raw/sent are exposed as URL builders (anchor `href`s) so the
browser streams the `text/plain` blob inline, per epic §6c ("let
the browser stream the blob"); they are not fetched into React
state.

## 7. Acceptance criteria (epic §14 BB10)

1. User enables mode from the GUI panel; panel re-fetches and shows
   zeroed/`null` stats (no activity yet).
2. A CLI `output exec` run (BB7b, out-of-band) that appends an event
   + writes a chunkSet is reflected in the panel on next refresh:
   stats totals non-zero, the event appears in the events list.
3. `/raw` and `/sent` endpoints stream the chunkSet content as
   `text/plain; charset=utf-8` with `content-disposition: inline`
   and the strict CSP header; an event without a stored chunkSet
   returns 404 `event_not_found`.
4. Disable zeros the summary, keeps the events JSONL, returns the
   session with `enabled: false`.
5. `SavingsBadge` shows on enabled-session list rows, hidden
   otherwise.
6. `design:design-critique` + `design:accessibility-review` pass in
   a fresh context (epic §6d, author != reviewer).
7. `pnpm verify` green; `code-reviewer` + `verifier` pass in
   separate contexts (epic §16 LOW/MEDIUM chain).

## 8. Design-chain checkpoints (epic §6d — mandatory, not sub-PRs)

For `token-saver-panel`, `token-saver-modal`, `token-saver-stats`,
`savings-badge`:

1. `huashu-design` — concept exploration (panel layout, modal,
   badge density).
2. `taste-skill` — chosen direction implementation guidance
   (engineering-heavy / metric-driven per CLAUDE.md §5b default).
3. `impeccable` — polish pass.
4. `design:design-critique` + `design:accessibility-review` in a
   separate context before merge.

All four reuse the existing `tokens.css` design tokens and the
`badges.tsx` `BASE` pill idiom — no new color/spacing primitives.

## 9. Risk & constraints

- Risk MEDIUM (epic §15) — bridge extension, same posture as the LL
  sessions routes. Standard superpowers chain + `code-reviewer`
  (epic §16 LOW/MEDIUM).
- `handler.ts` MUST stay ≤ 200 LOC (epic §14 BB10 / OO split).
- No agent-specific logic; routes are agent-agnostic (CLAUDE.md §1).
- Honest-data rule (epic §6c NOTE): events/raw/sent read from
  content-store / stats; when no events/chunkSets exist, routes
  return empty `[]` / JSON `null` / 404 — never fabricated data.
- English only; kebab-case files ≤ 300 LOC; Zod at boundaries;
  comments only for non-obvious WHY.
