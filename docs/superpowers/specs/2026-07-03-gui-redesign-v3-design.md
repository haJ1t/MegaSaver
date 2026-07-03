---
title: GUI Redesign v3 — sidebar shell + amber editorial
date: 2026-07-03
status: approved
risk: MEDIUM
scope: apps/gui frontend shell, navigation, information architecture, accent palette
base: main (new branch feat/gui-redesign-v3; supersedes the token-saver-fullwidth table refactor, which this redesign re-homes to a sidebar page)
reviewers: [code-reviewer]
---

# GUI Redesign v3

A frontend-only redesign of `@megasaver/gui`. The v2 "Editorial Workspace"
(warm monochrome, black accent, top-nav, everything stacked in the session
cockpit) evolves into a **six-page sidebar console with an amber accent**.
No bridge, API, or Core change — this is app-shell layout, navigation, and
information architecture only.

## Motivation

Two problems with v2:

1. **Cockpit overload.** Selecting a session opens `SessionCockpit`, which
   stacks 11 registry panels (transcript, telemetry, memory, memory-graph,
   tasks, token-saver — plus the five `ws-*` workspace panels), and the
   token-saver panel itself nests hook/proxy/saver/daemon controls. Five are
   explicitly `scope: "workspace"` and several `scope: "session"` panels
   (memory, the saver controls) are really project/global concerns — none of
   these belong behind a *session* selection.
2. **Flat top-nav does not scale.** Three pill items (`claude-sessions`,
   `agent-office`, `agent-setup`) leave no home for the workspace/global
   panels, so they were dumped into the cockpit.

The redesign promotes workspace/global concerns to first-class sidebar pages
and slims the cockpit to genuinely session-scoped content.

## Design language

Unchanged warm-monochrome skin (`--color-background #F7F6F3`, white surfaces,
`rounded-xl` cards, sans UI + DM Mono). One change: the accent flips from
**black → amber**.

- Light accent: `#B45309` (amber-700). Verified ≥4.5:1 on `#F7F6F3` and on
  white; amber-fg `#FFF7ED` on the amber fill ≥4.5:1.
- Dark accent: a lighter amber (candidate `#F59E0B` / amber-500) tuned to
  ≥4.5:1 on `--color-background #0C0D0F` and on `--color-surface #141519`.
  Exact hex pinned during implementation against the #85/#87 contrast bar.
- Accent applies to: active sidebar item (filled pill), primary buttons,
  and emphasis metrics (savings %). Status pastels (live/active/warn/danger/
  muted) are unchanged and keep their own hues.

`tokens.css` is **extended, not rewritten**: `--color-accent` /
`--color-accent-fg` (and dark variants) change value; the token *names* and
every consuming utility (`bg-accent`, `text-accent`, …) stay identical, so
non-shell components inherit the new accent for free.

## App shell

Top-nav header is replaced by a **persistent left sidebar**:

- Header: wordmark "Mega Saver".
- Six nav items (below).
- Footer: daemon status line (`● running` / stopped), reusing the existing
  `daemon-status` data source.
- Active item: amber filled pill; inactive: `text-secondary`, hover
  `surface-elevated`. `aria-current="page"` preserved.

No router is introduced. The existing `useState<ViewId>` pattern in `app.tsx`
is kept; `ViewId` (a closed enum with an AA3 `.test-d.ts` tuple pin) grows
from three to six members. Per the existing AA3 convention on this enum
(see the `view-id.ts` header comment), `VIEW_IDS` is **alphabetically
ordered**, and nav *display* order is defined separately via `NAV_VIEWS` in
`app.tsx`. So the enum tuple becomes:
`["agent-office", "agent-setup", "memory", "sessions", "token-saver", "workspace"]`
(alphabetic), while the sidebar renders them in the logical order
Sessions → Token Saver → Memory → Workspace → Agent Office → Setup via
`NAV_VIEWS`. The current `claude-sessions` member is **renamed to
`sessions`** (shorter, and the "Claude" qualifier is redundant once it is the
home page); `VIEW_LABELS` updated in lockstep; the `.test-d.ts` ordering pin
updated to the new six-member alphabetic tuple.

Layout: sidebar is a fixed-width left column (`~220px`); main content is the
right column, still capped for readability but no longer forced to
`max-w-5xl` on list-heavy pages that benefit from width. Responsive: below a
breakpoint the sidebar collapses to a top bar (icons + labels) — reduced-
motion honoured, no new animation vocabulary.

## Pages

| # | Page | Content | Source components today |
|---|------|---------|-------------------------|
| 1 | **Sessions** (home) | A summary strip (Workspaces / Sessions / Live counts) + workspace-grouped session list → selecting a session opens the slim cockpit. (See note on the deferred token-saved aggregate.) | `WorkspaceSessionList`, `session-cockpit` |
| 2 | **Token Saver** | Global controls: hook connection, proxy activation, daemon status; + saver-mode activation for the active workspace. (Per-session savings *stats* live in the cockpit rail, not here.) | `views/cockpit/{hook-connection,proxy-activation,daemon-status,saver-mode-activation}.tsx` (today nested inside `token-saver-panel.tsx`'s `<details>Advanced`) |
| 3 | **Memory** | Memory list + graph (+ approve/reject where present) for the active workspace | `views/cockpit/memory-panel`, `memory-graph-panel` (unchanged; take `dir,id`) |
| 4 | **Workspace** | Rules, permissions, index, tools, context | `Workspace{Rules,Permissions,Index,Tools,Context}CockpitPanel` (`cockpit/panels/workspace-panels.tsx`) |
| 5 | **Agent Office** | Existing view, moved into sidebar | `agent-office-view` |
| 6 | **Setup** | Existing agent-setup doctor, moved into sidebar | `agent-setup-doctor` |

The panels already exist as standalone components. The redesign
**relocates** them out of the cockpit `panel-registry` into their own page
shells; it does not rewrite their internals. Each fetches its own data via
existing clients (`claude-sessions-client`, `workspaces-client`,
`office-client`).

For the five **Workspace** panels this is pure composition: their bridge
routes are `GET /api/workspaces/:key/*` (session-independent, keyed only by
`workspaceKey`). But **Memory** and **saver activation** are *session-
anchored* at the bridge (`/api/claude-sessions/:dir/:id/…`) even though their
underlying data is workspace-scoped — there is no `/api/workspaces/:key/memory`
or `/api/workspaces/:key/token-saver` route. Moving them onto session-less
sidebar pages therefore needs a small **workspace-context seam** (next
section), not a route change.

### Session-anchored data seam (workspace context)

The three workspace/global sidebar pages (Token Saver, Memory, Workspace)
share one lifted **active-workspace** selection, resolved entirely on the
frontend — **no bridge route is added** (decision locked with the user,
2026-07-03; option: workspace picker, frontend-only).

- **Source**: the same session list the home page already fetches
  (`fetchClaudeSessions` → `groupSessionsByCwd`). Each group yields
  `{ key: encodeWorkspaceKey(cwd), cwd, label, rep: sessions[0] }` where
  `rep` is the most-recent session in that workspace.
  <!-- ponytail: single-sourced from the recent-session list; a workspace
  with zero sessions in the recent window won't appear. Fine for a
  single-dev tool; widen to fetchWorkspaces() only if that gap bites. -->
- **State**: `activeWorkspace` is lifted into `app.tsx` (a `useState`
  alongside `view`/`selected`), defaulting to the most-recent group. A shared
  `WorkspacePicker` component (a `<select>`/listbox of `label`s) sets it.
- **Consumption**:
  - **Workspace page** → passes `activeWorkspace.key` to the five workspace
    panels (they already take `workspaceKey`; the cockpit adapter wrappers
    that derived the key from a session `cwd` are replaced by direct
    `workspaceKey` props on the page).
  - **Memory page** → passes `activeWorkspace.rep.{dir,id}` to `MemoryPanel`
    + `MemoryGraphPanel` (unchanged components; they already take `dir,id`).
    Project-scoped memory is what surfaces, which is the intent.
  - **Token Saver page** → hook / proxy / daemon controls are global (no
    args); `SaverModeActivation` takes `activeWorkspace.rep.{dir,id}` (its
    route resolves cwd server-side, so any session in the workspace is
    equivalent).

The "representative session" is a deliberate, documented indirection: the
bridge keys these overlays by session id, but the *effect* is per-workspace,
so picking the workspace's latest session is correct and stable.

### Scope reconciliation (registry truth vs redesign)

`panel-registry.ts` tags each panel with an explicit `scope`:

- `scope: "workspace"` — `ws-index`, `ws-context`, `ws-rules`, `ws-tools`,
  `ws-permissions`. These map cleanly to the **Workspace** page (4).
- `scope: "session"` — `transcript`, `telemetry`, `memory`, `memory-graph`,
  `tasks`, `token-saver`.

Two session-scoped panels are **deliberately re-homed** by this redesign,
which is a conscious scope re-framing, not an accident:

- **Memory** (`memory` + `memory-graph`) → promoted to the sidebar **Memory**
  page. Rationale: the memory list/graph/approval is project-level, not tied
  to one session's lifetime; surfacing it only behind a session selection
  hides it. (If a future need for *per-session* memory view appears, it can
  return as a cockpit rail section — not in scope now.)
- **Token Saver**: the *controls* (`hook-connection`, `proxy-activation`,
  `saver-mode-activation`, `daemon-status`) are workspace/global by nature
  (per `wiki/entities/gui.md`: activation is per-cwd, the hook is global) →
  sidebar **Token Saver** page. The *per-session savings stats* slice stays
  in the slim cockpit rail (see below).

`tasks` (session-scoped) has no sidebar home and **stays in the slim
cockpit** as a session surface.

**Scope decisions (from brainstorm, locked):**
- Six pages exactly (option A) — Workspace stays its own page, not folded
  into Token Saver.
- Sidebar shell (not top-nav).

## Slim cockpit

Selecting a session opens a session-scoped detail view:

- **Header**: `← Sessions` back control, session title, live badge.
- **Main column**: transcript (existing `transcript-panel`), the primary,
  live-scrolling surface.
- **Right rail** (`~26%`): this-session token stats + telemetry (existing
  `telemetry-panel` + the session-scoped stats slice of `token-saver-panel`).
  The rail keeps the savings metric on screen while the transcript streams.
- **Tasks**: `tasks` is session-scoped and stays in the cockpit — surfaced
  as a rail section (or a secondary cockpit tab) below telemetry, not
  promoted to the sidebar.
- Narrow viewport: the rail wraps **below** the transcript (single column),
  not hidden.

The cockpit's session-scoped panel set after the redesign is therefore:
`transcript`, `telemetry`, `tasks`, and the session token-stats slice. The
`memory` / `memory-graph` panels and the five `ws-*` panels leave the
`panel-registry`; the `COCKPIT_TAB_GROUPS` `Workspace` and `Memory` groups
are removed because those are now sidebar pages. `panel-registry.ts` and
`COCKPIT_TAB_GROUPS` are edited to reflect the reduced set (their
`.test-d`/unit assertions, if any, updated in lockstep).

## What is preserved

- Dark mode auto via `prefers-color-scheme` (both accent variants shipped).
- WCAG AA contrast across the board, including the new amber pair — held to
  the #85/#87 standard (all body text ≥4.5:1).
- All a11y commitments in `DESIGN.md` §Accessibility: focus-visible rings,
  icon-button labels, `role="alert"` bridge errors, `aria-current`,
  reduced-motion.
- Existing motion language: list stagger (40ms/400ms cubic-bezier),
  150ms hover — no new motion vocabulary.
- Bridge, all `/api/*` routes, Core, connectors: untouched.

## Files touched (anticipated)

- `src/app.tsx` — top-nav → sidebar shell; view switch grows to six; holds
  the lifted `activeWorkspace` state + derives the workspace list from the
  session groups.
- `src/view-id.ts` + `src/view-id.test-d.ts` — enum + label + tuple pin.
- New: `src/components/sidebar.tsx` — the persistent nav (six items + daemon
  footer).
- New: `src/components/workspace-picker.tsx` — shared active-workspace
  `<select>` used by the three workspace/global pages.
- New: `src/lib/workspace-context.ts` — `WorkspaceOption` type +
  `deriveWorkspaceOptions(sessions)` (groups → `{key,cwd,label,rep}` via
  `groupSessionsByCwd` + `encodeWorkspaceKey`).
- New: `src/views/token-saver-page.tsx`, `src/views/memory-page.tsx`,
  `src/views/workspace-page.tsx` — thin shells composing existing
  `views/cockpit/*` panels against the active workspace.
- `src/cockpit/session-cockpit.tsx` + `src/cockpit/panel-registry.ts` +
  `src/cockpit/panels/*` — reduce to the session-scoped set (transcript,
  telemetry, tasks, session token-stats slice); add right-rail layout.
- `src/styles/tokens.css` — amber accent values (light + dark).
- `apps/gui/DESIGN.md` — v3 update (accent, sidebar, IA, cockpit).
- Component tests under `apps/gui/test/**` updated for moved panels and the
  new nav (relocations are position changes, not behaviour changes).

## Testing

- `ViewId` `.test-d.ts` tuple-ordering pin updated (AA3 discipline).
- Existing GUI test suite (255 tests) updated: nav assertions point at the
  sidebar; panel-presence assertions follow panels to their new page.
- New render tests for the three new page shells (each renders its composed
  panels; active-nav `aria-current` correct).
- Contrast: assert the amber accent pair meets ≥4.5:1 in the same style the
  #85/#87 work pinned it (computed-ratio check if one exists; otherwise a
  documented manual check in the verification evidence).
- `pnpm verify` green (biome + tsc + vitest).

## Risk

MEDIUM. Frontend-only; no Core/bridge/connector path, no user-file mutation,
no public CLI surface. Full superpowers chain applies (spec → plan → TDD →
verify → code-review). Reviewer: `code-reviewer`. Isolated worktree off
`main` (no direct `main` edits).

## Out of scope

- No router / URL-addressable pages (kept `useState`; revisit only if deep-
  linking is requested).
- No new bridge routes or data sources.
- No redesign of individual panel internals beyond what relocation forces
  (a panel that assumed a cockpit-width container may need a width tweak).
- No new dependency (no component/UI library, no icon package beyond what
  already ships).
- **No cross-session "tokens saved today" aggregate on the home page.** The
  bridge exposes savings only per-session (`readOverlaySummary`, keyed by
  session); there is no aggregate route, and the user-locked "no bridge
  change" rules out adding one now. The home summary strip therefore shows
  the cheaply-derivable counts (Workspaces / Sessions / Live) from the
  already-fetched session list; the flagship token-saved figure lives in the
  cockpit rail (per session). Upgrade path: a future `/api/stats/overview`
  that sums the on-disk overlay summaries would let the home page show a real
  daily total — a small, separate bridge task.
