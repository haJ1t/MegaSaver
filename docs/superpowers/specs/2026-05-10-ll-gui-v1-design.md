---
title: GUI v1 — picker, detail views, write actions, design pass
status: proposed
risk: MEDIUM
created: 2026-05-10
updated: 2026-05-10
---

# LL — GUI v1 (`apps/gui`)

> Successor to II / PR #53 (`docs/superpowers/specs/2026-05-10-ii-gui-app-design.md`).
> v0.3 shipped a read-only two-view bootstrap. v1 is the first GUI a Mega Saver
> single-developer can actually run as a daily console — picker, detail views,
> write actions, single-command dev, and a real design pass. Core/CLI/connector
> public surfaces remain untouched. Risk MEDIUM (per `CLAUDE.md` §12 — full
> superpowers chain + `code-reviewer`, no `architect`-level escalation needed
> beyond this spec).

---

## §1 Goal & success criteria

The v0.3 GUI proves the bridge architecture and renders read-only tables of
sessions and memory entries across every project in the active store. v1
turns that read shell into a usable single-developer console: pick a project,
inspect a session or a memory entry in a detail panel, create new sessions,
end or update them, create new memory entries, all under a deliberate visual
design system, all reachable from `pnpm --filter @megasaver/gui dev` as a
single command, and all keyboard-first.

**Done means…**

- A user can pick which project they are looking at; the picker persists
  across reloads via `localStorage`.
- The user can switch projects without reloading the page; the active project
  filter applies to both Sessions and Memory screens.
- Sessions screen shows a master-detail layout: list on the left, detail panel
  on the right; clicking a row populates the panel.
- Memory screen mirrors the same shape; the detail panel surfaces full
  content (no truncation), scope, creation timestamp, and the linked session
  if any.
- The user can `Create session` (modal/inline form) and the new session
  appears in the list without a manual reload.
- The user can `End` an open session from the detail panel; the row's status
  flips and the detail panel reflects `endedAt`.
- The user can `Update` an open session's title / risk / agent and see the
  patch reflected in the list.
- The user can `Create memory entry` against the active project (with optional
  session linkage when scope is `session`).
- A token-based design system ships (color, type, spacing, radius, shadow),
  drives every component, and respects `prefers-color-scheme` for dark mode.
- Every action is keyboard-reachable; focus is always visible; the app
  passes `design:accessibility-review` (WCAG 2.1 AA).
- `pnpm --filter @megasaver/gui dev` boots **both** Vite and the bridge in a
  single foreground command with shared shutdown.
- Tests pass: 626 (v0.3 baseline) → ≥ 660 with no skipped specs and no
  "deferred to next PR" coverage holes for any v1 feature.

Anything that is not on the "Done means…" list is explicitly v1.1+ (see §2).

---

## §2 Non-goals (carry forward to v1.1+)

The following are deliberately **not** in v1. They are good ideas that would
bloat the LL ship; each gets its own spec when its turn comes.

- **Native packaging.** No Tauri, Electron, or signed binary. v1 stays a
  localhost web app. Packaging is its own spec post-v1.
- **Real-time push.** No WebSocket / SSE. Mutations re-fetch the affected
  list; the GUI is single-user single-process (loopback bridge), so polling-
  on-mutation is sufficient.
- **Search / filter UI inside lists.** No free-text search, no tag filtering,
  no date range pickers. Project picker is the only filter that ships.
- **Connector status panel.** The `mega connector status` surface exists and
  is read-only; surfacing it in the GUI is v1.1+.
- **Doctor panel.** `mega doctor` output (store path, version, durability
  posture) is shell-only in v1.
- **Auth.** Single user, loopback origin only. Multi-user / token-based auth
  is post-v1.
- **Multi-store switching.** Bridge resolves a single store at boot via
  `MEGASAVER_GUI_STORE` / `XDG_DATA_HOME` / `$HOME/.local/share/megasaver`
  (same as v0.3). UI does not re-resolve at runtime.
- **Project create / update / delete from GUI.** The CLI owns project
  lifecycle in v1; GUI shows projects but does not write them. The empty-
  store and no-projects states must instruct the user to run
  `mega project create` (see §3 for IA).
- **Connector write actions** (`sync`, etc.). Read-only in v1; write
  surface is v1.1+.
- **i18n / Turkish strings.** v0.1 hardcoded English per `CLAUDE.md` §11;
  v1 holds that line. No `packages/shared/i18n` use yet.
- **E2E tests.** Playwright lands in v1.1+. v1 ships unit + integration +
  in-process bridge smoke (see §10).

---

## §3 Information architecture

### §3a Three top-level surfaces

```
┌──────────────────────────────────────────────────────────────────────┐
│  Top chrome:   [Mega Saver]   [Project: ▾ acme-app    ]   [Sessions │ Memory]
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   List pane (master)                Detail pane (detail)             │
│   ─────────────────────             ────────────────────             │
│   [+ New session]                                                    │
│   [row 1 · selected]                full session/memory data         │
│   [row 2]                           action buttons (End / Update)    │
│   [row 3]                                                            │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

Three surfaces:

1. **Project picker** — top chrome, always visible.
2. **Sessions screen** — master-detail, default landing.
3. **Memory screen** — master-detail, parallel shape.

The view switcher (`ViewId = ["memory", "sessions"]`) is preserved from v0.3
unchanged. Adding a new top-level view is out of scope.

### §3b Project picker (top chrome)

**Render:** a `<select>`-equivalent button (use a real `<button>` opening a
listbox, not a native `<select>`, so the design system can style consistently
and we get arrow-key navigation for free) showing the active project name and
an open-state caret. Clicking opens a listbox of every project from
`GET /api/projects`.

**Persistence:** `localStorage` key
`megasaver:gui:v1:active-project-id`. Shape: a single string (the project
UUID) or absent.

```
key:    "megasaver:gui:v1:active-project-id"
value:  "<uuid>"  // matches projectIdSchema
```

If the persisted value does not match any current project (project deleted
externally / store changed / first run), it is silently dropped and the
picker falls back to "no project selected" (see empty states).

**Empty states (LOCKED behavior):**

| Condition                                | Picker shows                               | List/detail shows                                                                              |
|-----------------------------------------|--------------------------------------------|------------------------------------------------------------------------------------------------|
| Store empty / no projects               | "No projects yet"                           | Helper card: `Run` `mega project create <name>` `to create your first project.` — non-clickable code blocks. |
| Projects exist, none selected           | "Select a project…" prompt + listbox open  | Helper card: `Pick a project to begin.`                                                          |
| Persisted project no longer exists      | falls back to "Select a project…"          | Same as above; on next select, persistence restores.                                             |
| Project selected, no sessions/memory    | normal                                     | Empty list + `[+ New session]` / `[+ New memory entry]` button always reachable.                 |

**First project create (post-pick):** when a single project is selected and
the picker just received a value, we DO NOT auto-create a session. The user
explicitly clicks `+ New session`. The `+` button is the only entry point to
session creation; no implicit creation paths.

**Locked decision:** project create / update / delete are CLI-only in v1
(see §2). The GUI never writes a project. If the user wants a new project,
they run `mega project create <name>` and reload the GUI.

### §3c Sessions screen (master-detail, single route)

**Layout:** a two-pane split inside the same view (NOT a separate route).

```
[+ New session]
─────────────────
| list rows ... | | detail pane: |
|               | |   {full session fields}     |
|               | |   [End session] [Update]    |
─────────────────
```

**Why same route, not a `/sessions/:id` route?** Justification in §14, but
short version: master-detail in one route preserves the URL-free SPA
contract from v0.3 (no router added), keeps the back-button untouched
(meaningful for a localhost console with no navigation depth), and
matches the actual interaction model where the user is always scanning
a list. Adding a router introduces a dependency and a navigation API
surface that costs us in tests and in component composition.

**Filtering:** the list is filtered to the active project from the picker.
Bridge accepts `?projectId=<uuid>` (see §4); frontend always passes it.
With no project selected, the list is suppressed in favor of the
helper-card empty state (see §3b).

**Columns (table or stacked cards — designer's call, but data must be
present):**

- Session id (mono short-id, e.g. first 8 chars + ellipsis on hover-full)
- Title (or `—` if null)
- Agent id
- Risk level
- Status (`open` / `ended`)
- Started at (ISO timestamp, designer may reformat to relative)

**Sort order (LOCKED):** newest `startedAt` first. No user-facing sort
control in v1 (defer to v1.1+ if needed). Document this in the empty
state when only one row exists ("Newest first").

**Click → detail:** clicking a row populates the detail pane with the
selected session id. Selection highlight on the row. Pressing `Esc`
clears the selection. Arrow-up / arrow-down move selection through
the list when the list has focus.

**Detail pane fields:**

- All session fields verbatim (`id`, `projectId`, `agentId`, `riskLevel`,
  `title`, `startedAt`, `endedAt`).
- Status pill (`open` / `ended`).
- Action buttons:
  - `End session` — visible only when `endedAt === null`. Confirms inline
    (no modal); a single click triggers `POST /api/sessions/:id/end`.
  - `Update` — opens an inline form (or modal — designer's call, but
    inline preferred) with `title`, `risk`, `agent` fields. Empty title
    submission clears (mirror CLI semantics). Disabled when
    `endedAt !== null`.

**Detail pane on no selection:** show an instructional card ("Pick a session
from the list, or create a new one with `+ New session` above.").

### §3d Memory screen (master-detail, parallel shape)

Identical IA to Sessions, with the following deltas:

- Master button: `[+ New memory entry]`.
- Columns: id (short), scope (`project` / `session`), session linkage
  (short id or `—`), content preview (≤80 chars + ellipsis), created at.
- Detail pane shows full content (no preview, no truncation) inside a
  monospace code block (memory content is line-oriented per CLI policy).
- Linked session: if `entry.sessionId` is non-null, render a "View session"
  link; clicking switches to the Sessions screen and selects that row
  (single-shot deep link). No router required — store pending selection
  in component state during the view switch.
- No `End` / `Update` actions on memory entries. Memory is append-only in
  v1 (mirrors the CLI: there is no `mega memory update` / `mega memory end`).

### §3e Top-chrome view switcher

Keep `ViewId = ["memory", "sessions"]` from v0.3. Render the buttons in
that tuple order (alphabetic) for AA3 consistency. No URL hash, no
router. `aria-current="page"` on the active button (already shipped in
v0.3 — preserve).

---

## §4 Bridge API contract

v0.3 ships:

- `GET /api/health`
- `GET /api/sessions` (all sessions across all projects)
- `GET /api/memory` (all memory entries across all projects)

v1 keeps all three for back-compat (the v0.3 smoke test continues to pass)
and adds:

| Method | Path | Body / params | Response | Status codes |
|---|---|---|---|---|
| `GET` | `/api/projects` | — | `Project[]` (registry-native shape, sorted by `createdAt` ascending) | 200, 500 |
| `GET` | `/api/sessions?projectId=<uuid>` | query | filtered `Session[]` (sorted `startedAt` desc) | 200, 400 (bad uuid), 404 (project not found), 500 |
| `GET` | `/api/memory?projectId=<uuid>` | query | filtered `MemoryEntry[]` (sorted `createdAt` desc) | 200, 400, 404, 500 |
| `POST` | `/api/sessions` | `{ projectId, agentId, title?, riskLevel? }` | created `Session` (201 ideally; 200 acceptable if simpler) | 201, 400, 404, 500 |
| `POST` | `/api/sessions/:id/end` | `{ endedAt? }` (optional ISO; default `now`) | ended `Session` | 200, 400, 404, 409 (already ended), 500 |
| `PATCH` | `/api/sessions/:id` | partial `{ title?, riskLevel?, agentId? }` | updated `Session` | 200, 400, 404, 409 (already ended), 500 |
| `POST` | `/api/memory` | `{ projectId, content, scope, sessionId? }` | created `MemoryEntry` | 201, 400, 404, 409 (e.g. session ended when scope=session), 500 |

**Locked: status code policy.** 200 for read + idempotent updates, 201 for
creates, 400 for malformed input (Zod failure or missing required field),
404 for unknown project/session, 409 for state-conflict (already-ended
session, scope/session mismatch), 500 for unexpected. Status code is the
primary contract; the body envelope (below) carries the precise reason.

### §4a Request body validation

All POST/PATCH bodies are validated by Zod schemas reused from
`@megasaver/core` and `@megasaver/shared`:

- `POST /api/sessions` body schema:
  ```ts
  z.object({
    projectId: projectIdSchema,
    agentId: agentIdSchema,
    title: z.string().min(1).optional(),  // mirrors titleSchema (NFC + trim
                                          // + control-char ban) — REUSE
                                          // titleSchema from
                                          // apps/cli/src/commands/session/shared.ts
                                          // hoisted to a shared module if not
                                          // already cross-package.
    riskLevel: riskLevelSchema.optional().default("medium"),
  }).strict();
  ```
- `POST /api/sessions/:id/end` body schema:
  ```ts
  z.object({ endedAt: z.string().datetime({ offset: true }).optional() })
   .strict();
  ```
- `PATCH /api/sessions/:id` body schema: `sessionUpdatePatchSchema` from
  `@megasaver/core` (already shipped, see `packages/core/src/session.ts:28`).
  Empty patch (no keys) → 400 with `validation_failed`. Empty `title`
  string → `null` (mirror CLI — see
  `apps/cli/src/commands/session/update.ts:101`).
- `POST /api/memory` body schema: mirror the cross-field guards from
  `runMemoryCreate` (`apps/cli/src/commands/memory/create.ts:34`):
  - `scope === "project"` rejects when `sessionId` is present (409
    `validation_failed`).
  - `scope === "session"` rejects when `sessionId` is absent (400
    `validation_failed`).
  - `sessionId` rejected if the session's `endedAt !== null` (409
    `session_already_ended`).

**Trust boundary:** the bridge is a system boundary per `CLAUDE.md` §8.
Every request body is parsed at the boundary; no internal call trusts
unparsed input. Re-parse on handoff to Core (the registry already does
this internally, but defense-in-depth — see the CLI's
parse-on-handoff comment at `apps/cli/src/commands/memory/create.ts:131`).

### §4b Error envelope

**Locked shape:**

```ts
type BridgeErrorBody = {
  error: string;            // human-readable message, English, single sentence
  code: BridgeErrorCode;    // closed-enum machine-readable code (see §7)
  details?: unknown;        // optional structured payload (e.g. zod issues)
};
```

The `error` field is required for human display. The `code` field is
required (no exceptions — every error path emits a closed-enum code).
The `details` field is optional; when `code === "validation_failed"`,
include the Zod issues array so the frontend can render field-level
hints (no raw stack traces).

The HTTP status communicates category (4xx vs 5xx); the `code` field
communicates exact reason. The frontend maps `code` to UI copy.

### §4c CORS posture

Loopback only. Locked decision:

- Vite proxy (existing `/api → 5174` proxy from v0.3) handles browser-
  side same-origin from `http://localhost:5173`.
- Bridge **rejects any request whose `Origin` header is set and is not
  one of**:
  - `http://localhost:5173`
  - `http://127.0.0.1:5173`
  - missing (server-to-server, vitest, curl)
- Rejection: 403 with `code: "origin_forbidden"`, no `Access-Control-Allow-Origin`
  header set.
- The bridge does NOT emit `Access-Control-Allow-Origin: *`. It emits
  `Access-Control-Allow-Origin: http://localhost:5173` only on a matched
  origin, never wildcard.
- Preflight (`OPTIONS`) supported for the documented mutating methods
  (`POST`, `PATCH`); responds with the matched origin + the methods/headers
  the routes accept.

This keeps a malicious local web page from drive-by-mutating the user's
store. Loopback is not magical — any browser tab on the same machine can
talk to `localhost:5174` if we let it.

### §4d Auth posture

Locked: **no auth in v1.** Single user, single process, loopback origin
gate above is the only access control. v1.1+ may layer a session cookie
or PSK in front of POST/PATCH; v1 documents the gap explicitly so the
v1.1 spec author does not have to re-derive it.

### §4e Idempotency posture

- POST creates are **non-idempotent**. The bridge generates UUIDs internally
  via `crypto.randomUUID()`; the request body does NOT carry an id field.
  Retrying a `POST /api/sessions` after a network blip produces two
  sessions. This is acceptable at v1 scale (single-user localhost, no
  retry middleware).
- PATCH and `POST /api/sessions/:id/end` target a specific id. Repeating
  `PATCH` is functionally idempotent if the body is identical (last write
  wins in the in-process registry). Repeating `end` returns 409
  `session_already_ended` on the second call — explicitly NOT idempotent
  by status code, but the user-visible state converges.

---

## §5 Frontend stack & styling decision

**Locked: Tailwind CSS v3.4 (JIT).**

### §5a Considered

| Option | Pros | Cons |
|---|---|---|
| Plain CSS modules | zero runtime dep, easy to reason about | every component re-implements layout primitives; tokens become string typos; designer agent has to write 2-4 files per component |
| `@vanilla-extract/css` | type-safe tokens, zero-runtime CSS, designer-friendly token contract | adds a Vite plugin + a build step; documentation is sparse vs Tailwind; the design agents in `taste-skill` / `impeccable` are tuned for utility-first idioms |
| **Tailwind v3.4 (JIT)** | designer/`taste-skill`/`impeccable` are tuned for it; tokens via `tailwind.config.js` resolve cleanly to CSS variables; dark mode flag built in; tree-shaken to ~ a few KB for our tiny SPA; iteration speed is fastest because designer can edit class strings directly without round-tripping through a stylesheet | adds a build dep (`tailwindcss`, `postcss`, `autoprefixer`); class-name density in JSX is a real readability concern; v4 exists |
| Tailwind v4 (alpha-stage) | future-direction; CSS-first config | not stable; Vite integration story still evolving; risk doesn't justify reward at this snapshot |

### §5b Locked call: Tailwind v3.4 (JIT)

**Rationale:**

- The design skill chain (`huashu-design` → `ui-ux-pro-max` → `taste-skill`
  → `impeccable`) is tuned for Tailwind utility classes. Asking those
  skills to author CSS-modules or vanilla-extract files is fighting the
  tool.
- The bundle is a tiny localhost SPA. Tailwind's JIT mode emits only the
  utilities actually referenced; the production CSS for v1 will be
  measured in single-digit KB after gzip. Bundle size is not a
  differentiator at this scale.
- Tokens land cleanly: `tailwind.config.js` exposes design tokens as
  utility classes (`bg-surface`, `text-secondary`, `rounded-md`), and
  the underlying CSS variables (`--color-surface`, etc.) drive both
  light and dark modes via a single `@media (prefers-color-scheme: dark)`
  block in the base layer. No dual stylesheet.
- We explicitly pin **v3, not v4**. v4 reorganizes config into CSS and
  the `@vitejs/plugin-react` integration is moving; v3.4 is rock-stable
  and well-documented. v4 migration is a v1.1+ chore-spec, not a v1
  blocker.

### §5c Build wiring

- `apps/gui/package.json` adds: `tailwindcss@^3.4`, `postcss@^8.4`,
  `autoprefixer@^10.4` as devDependencies.
- `apps/gui/postcss.config.js` ships with the Tailwind plugin.
- `apps/gui/tailwind.config.js` `content: ["./index.html", "./src/**/*.{ts,tsx}"]`.
- `apps/gui/src/styles.css` (new) loads `@tailwind base; @tailwind components;
  @tailwind utilities;` and defines the CSS variables for the design
  tokens (see §6) inside `:root` and a `prefers-color-scheme: dark`
  override.
- Vite picks PostCSS up automatically; no `vite.config.ts` change required.

---

## §6 Design system tokens (initial)

The designer (skill chain in §13) produces concrete values; this spec
locks the **shape** of the token surface. Each subsection enumerates the
CSS-variable / Tailwind-config keys, not the values. The rule: every
hardcoded color/size/space/radius/shadow in JSX is a bug — the
`design:design-critique` pass flags it pre-merge.

### §6a Color (semantic, closed enum)

CSS variables under `:root` + `[data-theme="dark"]` overrides
(or, since dark is auto-only in v1, `@media (prefers-color-scheme: dark)`):

```
--color-background        // page background
--color-surface           // card / list / detail panel base
--color-surface-elevated  // selected row, modal background
--color-text-primary      // headings, body
--color-text-secondary    // metadata, timestamps
--color-text-muted        // disabled / placeholder
--color-border            // dividers, inputs
--color-accent            // primary action ("New session")
--color-accent-fg         // text on accent
--color-danger            // destructive ("End session")
--color-danger-fg
--color-warn              // medium-risk badge, warnings
--color-warn-fg
--color-ok                // open status, success
--color-ok-fg
--color-focus-ring        // accessibility focus indicator
```

**Closed enum:** the set above is exhaustive for v1. Adding a new color
role requires a spec amendment, NOT an inline hex literal in a component.

### §6b Typography

- `--font-family-sans`: system stack or designer-picked single family
  (locked: ONE family, not multiple — trim font loading).
- Scale (Tailwind already provides this — pin used names):
  `text-xs` (small caps / table metadata), `text-sm` (body in dense
  tables), `text-base` (default), `text-lg` (subheads), `text-xl`
  (page title). No `text-2xl` and above in v1; if the designer wants
  bigger, they amend this spec.
- Weight: `font-normal` (400), `font-medium` (500), `font-semibold` (600).
  No 700/800 in v1.

### §6c Spacing (4 px base)

Tailwind defaults already on a 4 px scale. Pin the **subset** v1 uses:
`0`, `1` (4 px), `2` (8 px), `3` (12 px), `4` (16 px), `6` (24 px),
`8` (32 px), `12` (48 px). Anything else is a spec amendment.

### §6d Radius

`rounded-none`, `rounded-sm`, `rounded-md` (default for cards/buttons),
`rounded-lg` (modal), `rounded-full` (pills, avatars). No others in v1.

### §6e Shadow

`shadow-none`, `shadow-sm` (cards), `shadow-md` (modal/elevated). No
other elevations.

### §6f Dark mode

- Auto via `@media (prefers-color-scheme: dark)` in `styles.css`.
- Tokens are CSS variables; the dark block redefines variable values.
  Components do NOT branch on `theme`; they reference variables.
- **Locked:** no manual theme toggle in v1. The OS preference IS the
  preference. Manual toggle is v1.1+ (it requires a persistence model
  + a render-time theme provider, which both deserve their own
  spec lines).

### §6g Status / risk / agent badges

Reuse the closed enums Core ships:

- `RiskLevel = ["critical", "high", "low", "medium"]` → mapped to
  badge variants via the design system.
- `AgentId` → mirror `agentIdSchema.options` from
  `packages/shared/src/agent-id.ts` — DO NOT rewrite.
- `MemoryScope = ["project", "session"]`.
- Session status: derive from `endedAt`: `open | ended` (not a Core
  enum, but a closed two-value derived state).

The badge component takes the enum value as a prop and renders the
correct token-driven style. **No inline color choices in JSX.**

---

## §7 Closed-enum surface

Per `CLAUDE.md` §8 and AA3 (tuple-ordering pin), every closed enum gets a
`.test-d.ts` regression assertion.

### §7a Existing (preserve)

- `ViewId = ["memory", "sessions"]` (alphabetic) — already pinned in
  `apps/gui/test/view-id.test-d.ts`. Keep order.

### §7b New in v1

- `WriteAction = ["create-memory", "create-session", "end-session", "update-session"]`
  (alphabetic). Used by the frontend form-state reducer to identify
  which write flow is active. File: `apps/gui/src/write-action.ts`,
  test: `apps/gui/test/write-action.test-d.ts`.
- `BridgeErrorCode = [...]` (alphabetic, exhaustive list below). Used
  by the bridge error envelope and the frontend's error→copy map.
  File: `apps/gui/src/bridge-error-code.ts` (frontend; mirrored in the
  bridge), test: `apps/gui/test/bridge-error-code.test-d.ts`.

```
BridgeErrorCode = [
  "internal_error",            // 500 fallback
  "method_not_allowed",        // 405
  "origin_forbidden",          // 403, CORS gate (see §4c)
  "project_not_found",         // 404 on projectId lookup
  "route_not_found",           // 404, unknown path
  "session_already_ended",     // 409
  "session_not_found",         // 404
  "session_project_mismatch",  // 409, memory create with cross-project session
  "store_write_failed",        // 500, atomicWriteFile failure (real EPERM, etc.)
  "validation_failed",         // 400, Zod failure or missing required field
];
```

(Alphabetic. Exhaustive for v1. New codes require this list to grow + a
fresh `.test-d.ts` assertion update + a doc paragraph in this spec.)

**Locked: pin file format.** Each `.test-d.ts` uses the AA3-canonical
shape (`expectTypeOf<...>().toEqualTypeOf<readonly [...]>()` + `.toEqual([
"...", ...])`) so member AND format drift fails.

---

## §8 Single-command dev

**Locked: `concurrently`.**

### §8a Considered

| Option | Pros | Cons |
|---|---|---|
| `concurrently` runs Vite + bridge as separate processes | plug-and-play, ten lines of config, npm-popular, works on macOS/Linux/Windows alike | two log streams interleaved (acceptable with prefixes); two PIDs to clean up (concurrently handles SIGINT broadcast); not "elegant" |
| Vite middleware mode — bridge mounted into Vite dev server | one process, one logger, hot-reload of `apps/gui/src` works seamlessly with bridge | bridge lifecycle ties to Vite; HMR of `bridge/server.ts` source is awkward (vite-node would have to evaluate it); wiring `node:http` server **inside** Vite's connect-style middleware requires adapter code we'd own; harder to test bridge in isolation |
| Custom `apps/gui/scripts/dev.ts` script with `child_process.spawn` + shared SIGINT | maximum control, can add per-stream prefixes / colorization / health probes | the most code we own; reinvents `concurrently`; one more `tsx` import path to debug |

### §8b Locked call: `concurrently`

The brief explicitly recommends this; it's the right answer.

- v1 ships strong enough as a daily console without elegant single-process
  hot-reload.
- `concurrently` ships built-in `--kill-others-on-fail` and SIGINT
  broadcast, so Ctrl-C in the parent terminates both children. That is
  the only signal-handling we need.
- We avoid owning a custom dev script; if v1.1+ wants Vite middleware
  mode for a tighter dev loop, that becomes its own spec.

### §8c Scripts (LOCKED)

`apps/gui/package.json` `scripts`:

```jsonc
{
  "dev": "concurrently --kill-others-on-fail --names vite,bridge --prefix-colors auto \"vite\" \"node --import tsx bridge/server.ts\"",
  "dev:vite": "vite",
  "dev:bridge": "node --import tsx bridge/server.ts",
  "build": "vite build",
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc -b --noEmit && tsc -p tsconfig.test.json --noEmit",
  "clean": "rm -rf dist .turbo"
}
```

The old `dev` (Vite-only) becomes `dev:vite`; old `bridge` becomes
`dev:bridge`. Single-command: `pnpm --filter @megasaver/gui dev`. Both
escape hatches preserved for debugging the bridge in isolation or running
under a different debugger.

`concurrently` lands as a `devDependency` of `apps/gui`. No root-level
change.

### §8d Port collisions

Bridge defaults to 5174 (preserved from v0.3); Vite to 5173. Both
remain overridable via env (`MEGASAVER_GUI_BRIDGE_PORT` / Vite's `--port`).
Document in README that running two GUIs on the same machine requires
manual port overrides; in v1 we don't auto-discover.

---

## §9 Accessibility commitments

Concrete, not aspirational. Each commitment is testable; the
`design:accessibility-review` pass enforces them pre-merge.

1. **Keyboard reachable.** Every action — picker open, project select,
   row select, button click, form submit, modal open/close, link follow
   — is reachable via Tab/Enter/Esc and arrow keys in lists and listboxes.
   No mouse-only paths.
2. **Focus visible.** Every focusable element has a visible focus ring
   (`--color-focus-ring`). NO `outline: none` without a token-defined
   replacement. The default Tailwind focus utilities are configured
   (or extended) to use `--color-focus-ring`.
3. **Screen-reader labels.** Every icon-only button has an `aria-label`
   (e.g. `+ New session` is fine because it has visible text; a `×`
   close button gets `aria-label="Close"`). The view switcher uses
   `<nav role="tablist">` if it remains tab-shaped (v0.3 used a
   `<nav>` with buttons — keep the simplest valid shape).
4. **Contrast.** WCAG AA for body text (4.5:1 minimum); AAA for status
   badges where palette permits. The `design:accessibility-review` pass
   runs contrast on every token pair documented in §6.
5. **Motion.** Respect `prefers-reduced-motion: reduce`. Any transition
   longer than 150 ms must be wrapped:
   ```css
   @media (prefers-reduced-motion: reduce) {
     * { transition: none !important; animation: none !important; }
   }
   ```
6. **Forms.** Every input has a programmatically associated `<label>`
   (or `aria-labelledby`). Errors render adjacent to the input with
   `aria-describedby` linking the error id. Submission errors from the
   bridge land in a `role="alert"` region.
7. **No drag-only or hover-only interactions.** Selection is click /
   Enter. Hover is preview / tooltip ONLY; the same data is reachable
   via keyboard focus + screen reader.
8. **Reachable error states.** When the bridge returns an error, the
   error envelope's `error` field renders in a visible
   `role="alert"` element AND focus is moved to it (so screen readers
   announce). Generic `internal_error` falls back to "Something went
   wrong. Try again." with the `code` shown in small print for support.

---

## §10 Test strategy

v0.3 baseline: 626 passing tests across 62 files. v1 target: ≥ 660 (delta
+34 to +50). Below is the **commitment**, not a "we'll add tests later"
note. Every feature in §3 carries tests in this slot; nothing defers.

### §10a Unit (per-component)

One `*.test.tsx` per component; minimum one happy-path render test plus
one branch test for stateful components. Tests live next to the existing
`apps/gui/test/`. Files:

- `app.test.tsx` (existing — extend with picker tests)
- `project-picker.test.tsx` (new)
- `sessions-list.test.tsx` (new)
- `sessions-detail.test.tsx` (new)
- `session-create-form.test.tsx` (new)
- `session-update-form.test.tsx` (new)
- `memory-list.test.tsx` (new)
- `memory-detail.test.tsx` (new)
- `memory-create-form.test.tsx` (new)
- `badge.test.tsx` (new — risk/agent/scope/status badges)

Minimum delta: +9 component test files × ≥ 2 cases each = +18 tests.

### §10b Integration (frontend)

Use `@testing-library/react` + `vi.stubGlobal("fetch", ...)` to mock the
bridge. Test files in `apps/gui/test/integration/`:

- `picker-switch.test.tsx` — picker switches project, sessions list
  re-fetches with new `?projectId=`, list updates without manual reload.
- `create-session-flow.test.tsx` — submit form, POST mocked, list
  updates.
- `end-session-flow.test.tsx` — click End, POST mocked, status pill
  flips to `ended`.
- `update-session-flow.test.tsx` — submit patch form, PATCH mocked,
  list row updates.
- `create-memory-flow.test.tsx` — submit form (project + session
  scope), POST mocked, list updates.
- `error-envelope.test.tsx` — bridge returns 400 / 404 / 409 / 500;
  `role="alert"` renders the right copy and `code`.
- `localstorage-persistence.test.tsx` — pick project → reload (re-mount
  `<App />`) → picker shows persisted project; corrupted / orphaned
  value → falls back to "Select a project…".

Delta: +7 integration files × ≥ 2 cases = +14 tests.

### §10c Closed-enum pins

`.test-d.ts` files (vitest typecheck mode):

- `view-id.test-d.ts` (existing, unchanged)
- `write-action.test-d.ts` (new)
- `bridge-error-code.test-d.ts` (new — mirrored on both bridge and
  frontend for cross-package alignment)

Each pins tuple ordering AND member set per AA3.

### §10d Bridge tests (`apps/gui/test/bridge/`)

Bridge endpoints test against an in-memory store via
`createInMemoryCoreRegistry()` from `@megasaver/core`
(`packages/core/src/registry.ts:26`). The bridge's request handler is
extracted into a pure function (`createBridgeHandler({ registry })`) so
tests can call it without binding to a port; an in-process `http`
listener wraps it for production.

Files:

- `bridge-projects.test.ts` (GET /api/projects — empty store, populated)
- `bridge-sessions-get.test.ts` (filter by project, bad uuid → 400,
  unknown project → 404)
- `bridge-sessions-post.test.ts` (happy + 400 missing field + 404
  project not found)
- `bridge-sessions-end.test.ts` (happy + 404 + 409)
- `bridge-sessions-patch.test.ts` (happy + 400 empty patch + 409 ended)
- `bridge-memory-get.test.ts` (filter, bad uuid, unknown project)
- `bridge-memory-post.test.ts` (project + session scope, cross-field
  guard, ended-session reject)
- `bridge-cors.test.ts` (matched origin OK, unmatched origin → 403,
  preflight OPTIONS)
- `bridge-error-envelope.test.ts` (every code path emits the locked
  envelope shape)

Delta: +9 bridge test files × ≥ 2 cases = +18 tests.

### §10e Smoke test (in-process bridge)

One spec spins up the bridge in-process (uses `createServer` + ephemeral
port) on top of an in-memory registry seeded with one project / one
session / one memory entry. Calls `fetch` (jsdom or `undici`) against
each endpoint, asserts the response shape and status. File:
`apps/gui/test/smoke/bridge-smoke.test.ts`.

Delta: +1 file × ≥ 5 endpoints exercised = +5 tests.

### §10f Coverage target

Total delta floor: 18 + 14 + 18 + 5 = **+55** tests (no test-d delta
counted; `.test-d.ts` files run under `typecheck`, not the runtime
counter, but each adds 1 typecheck assertion).

626 → ≥ 681 expected. The brief's range (660–680) is the soft target;
this spec commits to the lower bound at minimum. The DoD gate (§13)
checks this number.

### §10g E2E

**Locked: deferred.** Playwright lands in v1.1+. v1's smoke test
(§10e) covers end-to-end through the bridge but stops short of
real-browser DOM interaction. Justification: Playwright pulls in a
browser binary cache and a CI runner story that we have not invested
in yet. Adding it inside v1 turns the LL ship into a CI-infra
overhaul. The bridge smoke + frontend integration (with `fetch`
mocked) cover all surfaces today; Playwright is the next gate, not
this one.

---

## §11 Migration & rollout

- **v0.3 GUI users.** v1 is a drop-in replacement for the bootstrap.
  The two read views remain (Sessions and Memory), now richer; the
  read-only workflow continues to work. No CLI / Core / connector
  surfaces change; no user files outside the store change.
- **`localStorage` namespacing.** All keys carry the `megasaver:gui:v1:`
  prefix. v0.3 wrote nothing to `localStorage`, so collision is
  theoretical, but the prefix future-proofs us against v2 schema
  shifts (v2 will use `megasaver:gui:v2:`).
- **Ports unchanged.** Bridge stays on 5174; Vite stays on 5173. Vite
  proxy config in `vite.config.ts` (`/api → 5174`) remains valid.
- **Workspace dependencies.** New devDeps land scoped to
  `apps/gui/package.json`: `tailwindcss`, `postcss`, `autoprefixer`,
  `concurrently`. New runtime deps: none beyond what v0.3 ships
  (`@megasaver/core`, `@megasaver/shared`, `react`, `react-dom`).
- **Wiki.** Append a `wiki/entities/gui.md` page (subsystem entity)
  and update `wiki/index.md` Status section under v0.4 (the next
  release line) listing v1 capabilities. The `wiki/CLAUDE.md`
  schema requires this entity page since the GUI now writes through
  the bridge — it is a real subsystem, not a placeholder.
- **CHANGESET.** No public package API changes (`@megasaver/gui` is
  `private: true`). Per `CLAUDE.md` §9 item 9, no changeset needed.

---

## §12 Out-of-scope decisions to NOT make in this PR

These come up naturally during implementation; the LL PR explicitly
defers each. The implementer who hits one references this list and
moves on.

- **Native packaging** (Tauri / Electron / `electron-builder` / signed
  binary). Separate spec, post-v1.
- **Auth / session-cookie / PSK.** Loopback origin gate (§4c) is the
  only access control. v1.1+.
- **WebSocket / SSE / real-time push.** Polling-on-mutation is the
  contract. Adding a push channel changes the bridge API surface and
  introduces back-pressure questions.
- **MCP-bridge serving.** `@megasaver/mcp-bridge` (PR #52 placeholder)
  is its own package and its own spec when the real implementation
  lands.
- **`mega connector status` / `mega doctor` panels in GUI.** Read-only
  surfaces exist on the CLI; surfacing them in GUI is v1.1+.
- **Project create / update / delete from GUI.** CLI owns project
  lifecycle in v1 (see §3b).
- **Memory edit / delete.** Memory is append-only at the CLI; GUI
  follows.
- **Manual dark/light theme toggle.** Auto only via
  `prefers-color-scheme` (see §6f).
- **i18n / Turkish strings.** v0.1 hardcoded English per `CLAUDE.md`
  §11.
- **Search / filter inside lists.** Project picker is the only filter
  in v1 (see §2).

---

## §13 Definition of Done for the LL ship

Strict, per `CLAUDE.md` §9 + §12 (MEDIUM risk). Each gate names its
agent. **Author and reviewer never share active context per `CLAUDE.md`
§9 item 6 and §13 anti-pattern.**

| # | Gate | Author / Skill | In a fresh context? |
|---|---|---|---|
| 1 | This spec (`docs/superpowers/specs/2026-05-10-ll-gui-v1-design.md`) | `architect` (this pass) | yes |
| 2 | Plan (`docs/superpowers/plans/2026-05-10-ll-gui-v1-plan.md`) | `planner` | yes |
| 3 | Component implementation (Tailwind + tokens + components) | `designer` agent driving the chain `huashu-design` → `ui-ux-pro-max` → `taste-skill` → `impeccable` | yes |
| 4 | Bridge implementation + frontend integration + write actions | `executor` (opus) | yes |
| 5 | Tests (TDD per `CLAUDE.md` §4 + §10 plan above) | `test-engineer` | yes |
| 6 | Pre-merge code review | `code-reviewer` (fresh context). Includes running `design:design-critique` and `design:accessibility-review` against the running GUI. | yes |
| 7 | Verifier — `pnpm verify` green + smoke evidence captured | `verifier` (fresh context, `omc:verify`) | yes |

**Hard gates (must all pass before "done" claim):**

- `pnpm install` clean.
- `pnpm verify` green at repo root (lint + typecheck + test).
- Test count ≥ 660 (§10f).
- `pnpm --filter @megasaver/gui dev` boots Vite + bridge in one
  command; Ctrl-C tears both down.
- Smoke evidence: screenshot of empty store ("Run `mega project create`"),
  populated store with a session selected, dark mode auto-applied, write
  flow happy path (create session → list updates).
- Wiki: `wiki/entities/gui.md` created; `wiki/index.md` Status v0.4
  section updated.

**Anti-pattern guards (per `CLAUDE.md` §13):**

- No "wip" or "temporary" commits.
- No half-implementations (every Done bullet from §1 is real, not
  stubbed).
- No agent-specific logic in `@megasaver/core` (we don't touch Core).
- No `--no-verify` on commits.
- No author-as-reviewer collisions.

---

## §14 Alternatives considered (briefly)

### §14a Master-detail vs route-per-detail

- **Locked:** master-detail in one view (no router).
- **Why not a router?** Adding `react-router` (or Tanstack Router) costs
  a dependency, a navigation test surface, and a learning curve for the
  designer agents (which expect a single tree). The localhost console
  doesn't benefit from URL navigation: there is no shareable link, no
  back-button context worth preserving, no deep-link from outside.
- **Why not separate routes anyway?** The detail view shares > 80% of
  its data with the list (it just zooms a row). Splitting would force a
  re-fetch of the whole list every navigation, OR a global cache layer.
  Both cost more than they save.
- **Tradeoff:** with no router, "the back button does nothing in v1" is
  a documented behavior. The `Esc` key clears selection (the closest
  spiritual back-button). v1.1+ may add a router if the user repeatedly
  asks for shareable URLs.

### §14b Polling-on-mutation vs WebSocket

- **Locked:** polling-on-mutation. After every successful write, the
  affected list re-fetches via the same `GET` it already uses. No
  background polling.
- **Why not WebSocket?** Single-user single-process means there is no
  external mutation to listen for. The bridge writes, the bridge knows.
  WebSocket adds a connection-lifecycle, reconnect-with-backoff,
  back-pressure surface that pays no dividend at v1 scale.
- **Tradeoff:** if a future v1.1+ adds another writer (e.g. CLI runs
  in another terminal while GUI is open), the GUI will not auto-refresh
  until the user clicks. Acceptable; the user can press a refresh action
  if/when needed (no UI affordance ships in v1 — they reload the page).

### §14c Tailwind v3.4 vs vanilla-extract / CSS modules

- **Locked:** Tailwind v3.4 (JIT). See §5b.
- **Why not vanilla-extract?** Type-safe tokens are appealing, but the
  designer skill chain (`taste-skill` etc.) is utility-class native;
  fighting that costs more than the type-safety wins.
- **Why not CSS modules?** Every component re-implements its own layout
  primitives; tokens become string typos; designer agents have to
  round-trip through stylesheet files for every change. Slowest
  iteration of the three.

### §14d `concurrently` vs Vite middleware mode vs custom dev script

- **Locked:** `concurrently`. See §8b.
- **Why not Vite middleware?** Bridge lifecycle ties to Vite's; HMR of
  bridge code is awkward; testing the bridge in isolation gets harder.
- **Why not a custom dev script?** Reinvents `concurrently` for no win;
  one more file to own.

### §14e Bridge schema generation

- **Considered:** generating bridge handler / schema definitions from
  Core's Zod schemas via a code-gen step.
- **Locked:** no codegen in v1. The bridge is small enough (≤ ~10
  endpoints) that hand-written handlers calling `schema.parse()` at the
  boundary is clearer and shorter. Codegen is a v2 lever when the
  bridge surface multiplies.

### §14f Where do bridge tests live

- **Considered:** putting bridge tests in `packages/core` because they
  exercise registry behavior.
- **Locked:** they live in `apps/gui/test/bridge/` because they test
  the bridge's HTTP shape, not Core's contract. Core has its own tests.
  This keeps the package boundaries clean per `CLAUDE.md` §8.

---

## References

- `apps/gui/src/app.tsx` — current view switcher to extend with project picker chrome.
- `apps/gui/src/view-id.ts:1` — alphabetic-tuple convention to mirror in new enums.
- `apps/gui/src/views/sessions-view.tsx:32` — current sessions table to evolve into list + detail.
- `apps/gui/src/views/memory-view.tsx:43` — current memory table to evolve into list + detail.
- `apps/gui/src/lib/api-client.ts:8` — `getJson` helper to extend with POST/PATCH wrappers.
- `apps/gui/bridge/server.ts:38` — current routes table to extend with all v1 routes.
- `apps/gui/bridge/store-path.ts:11` — store resolution (preserve verbatim).
- `apps/gui/test/app.test.tsx` — existing smoke test, fetch-stubbing pattern reused.
- `apps/gui/package.json:9` — scripts block to replace per §8c.
- `apps/gui/vite.config.ts:11` — proxy config (preserve unchanged).
- `apps/cli/src/commands/session/create.ts:32` — CLI semantics to mirror in `POST /api/sessions`.
- `apps/cli/src/commands/session/end.ts:25` — CLI semantics to mirror in `POST /api/sessions/:id/end`.
- `apps/cli/src/commands/session/update.ts:27` — CLI semantics to mirror in `PATCH /api/sessions/:id`.
- `apps/cli/src/commands/memory/create.ts:34` — CLI semantics to mirror in `POST /api/memory`.
- `apps/cli/src/commands/project.ts:64` — project list contract surfaced to `GET /api/projects`.
- `packages/core/src/registry.ts:12` — `CoreRegistry` interface (bridge's only Core surface).
- `packages/core/src/registry.ts:26` — `createInMemoryCoreRegistry()` for bridge tests.
- `packages/core/src/session.ts:9` — `sessionSchema` reused for bridge response validation.
- `packages/core/src/session.ts:28` — `sessionUpdatePatchSchema` reused for `PATCH /api/sessions/:id`.
- `packages/core/src/memory-entry.ts` — `memoryEntrySchema` reused for bridge response validation.
- `docs/superpowers/specs/2026-05-10-ii-gui-app-design.md` — v0.3 bootstrap (predecessor).
- `CLAUDE.md` §4 (process), §8 (boundaries / file size), §9 (DoD), §12 (risk modes), §13 (anti-patterns).
- `wiki/index.md` — v0.3 capability matrix; v0.4 status section to be appended on merge.
