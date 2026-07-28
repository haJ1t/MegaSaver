---
title: GUI Console Redesign (Claude Design import)
risk: MEDIUM
status: approved
created: 2026-07-28
updated: 2026-07-28
source: claude.ai/design/p/124f5957-033b-44fe-a98f-36293bd0f18f — "Mega Saver Console.dc.html"
---

# GUI Console Redesign

Imports the "Mega Saver Console" prototype from Claude Design and rebuilds
`apps/gui` around it. Frontend-only: **no bridge route, no Core change, no
new `BridgeErrorCode` member.**

## 1. Source

The prototype is a `.dc.html` document — a template using the `x-dc` runtime
(`support.js`) with `{{ }}` bindings, `sc-if` / `sc-for` control flow,
`style-hover`, and a `DCLogic` subclass holding state in `renderVals()`.
The runtime is **not** ported. The prototype is read as a design
specification and re-expressed in the app's existing React 18 + Tailwind
idiom. `hint-placeholder-*` attributes are design-console preview hints and
carry no product meaning.

Every value in the prototype's script is a mock constant (`WORKSPACES`,
`GROUPS`, `BARS`, `TRANSCRIPT`, `BRAIN`, `AGENTS`, …). Per CLAUDE.md §13
("no half-implementations"), each design surface must resolve to a real
bridge route or be omitted. §4 below is that map.

## 2. What changes

- **Seven nav items** in three labelled groups, replacing the flat six:
  - *Monitor* — Overview (new), Sessions
  - *Optimize* — Token saver, Memory
  - *Configure* — Workspace, Agent office, Setup
- **New app chrome**: a top header carrying the workspace switcher, a ⌘K
  command palette, and a live-session count; a sidebar footer with daemon
  status and a theme toggle; a bottom-centre toast.
- **New visual language**: warm paper canvas, Instrument Sans / Instrument
  Serif / DM Mono, 14–16px radii, hairline `--line-soft` row separators,
  soft-tinted status pills.
- **Overview page** (new) — the savings headline, system readiness, and live
  sessions.

## 3. Token system

`tokens.css` is restructured. The prototype's role names map onto the
existing closed set where one exists; genuinely-new roles are added here as
the required spec amendment (per the `tokens.css` header rule).

| Prototype | Existing token | Action |
|---|---|---|
| `--bg` | `--color-background` | retune value |
| `--surface` | `--color-surface` | retune |
| `--raised` | `--color-surface-elevated` | retune |
| `--line` | `--color-border` | retune |
| `--ink` | `--color-text-primary` | retune |
| `--ink-2` | `--color-text-secondary` | retune |
| `--ink-3` | `--color-text-muted` | retune |
| `--accent` / `--ok` / `--warn` / `--danger` | same roles | retune |
| `--line-soft` | — | **new** — hairline row separator, weaker than `--color-border` |
| `--*-soft` (accent/ok/warn/danger) | `--status-*-bg` | reuse existing status-bg roles |
| `--shadow` | `shadow-sm` | **new** `--color-shadow`, two-layer |

### 3a. Accessibility corrections (binding)

The prototype's palette fails WCAG AA in three places. PRs #85 and #87 were
dedicated contrast fixes; regressing them is not acceptable. Corrected
values, verified at ≥4.5:1 for every text role against every surface it is
painted on (background, surface, raised, and its own `-soft` pill fill):

| Role | Prototype | Shipped | Why |
|---|---|---|---|
| light `--ink-3` | `#8d877c` | `#6a645a` | 3.19:1 on canvas → 5.24:1 |
| dark `--ink-3` | `#71747c` | `#868a93` | 3.48:1 on raised → 4.71:1 |
| light `--accent` | `#b45309` | `#a84d07` | 4.49:1 on the warmer paper → 5.04:1 |

`--ink-3` carries timestamps, counts, and section labels at 10–11px — normal
text under WCAG, so the 4.5:1 threshold applies, not 3:1.

The prototype's `accentColor` prop defaults to `#3f6f5a` (green) while its
CSS `:root` is amber. The amber is the product decision; the prop is a
design-console knob and is ignored.

### 3b. Illustration palette (token-rule exemption)

`tokens.css` states "do NOT add inline hex literals in components". The
agent-office floor plan (`views/office/office-floor.tsx`) is the one sanctioned
exception: its skin tones, hair tones, monitor bezel and screen-line greys are
**illustration fill, not semantic roles**. They do not vary by theme, carry no
meaning a reader must decode, and adding ~16 `--illus-*` variables would bloat
the closed role set with values nothing else can reuse.

The exemption is scoped to that one file and to decorative fills only. Anything
in the illustration that *does* carry meaning — desk selection, the screen glow,
status colour on the figure's shirt — uses real tokens (`--color-accent`,
`--color-ok`, `--color-warn`, `--color-danger`, `--color-border`).

Layout note for maintainers: the monitor is deliberately **left-offset, not
centred**. It renders at `z-4` and the seated figure at `z-2`, so centring the
monitor hides the occupant completely. The empty-desk state looks more balanced
centred — do not "fix" it that way.

### 3c. Theme

The prototype hard-switches on `[data-theme="dark"]`, dropping OS
preference. Shipped behaviour follows the OS **and** allows a manual
override:

```css
:root { /* light */ }
[data-theme="dark"] { /* dark */ }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* dark */ }
}
```

`test/styles/accent-contrast.test.ts` currently locates the dark block with
`indexOf("@media")`. That breaks under this structure and must be updated to
select blocks by selector, not by ordinal.

## 4. Backing map

### Backed — built against real routes

| Surface | Route / client |
|---|---|
| Overview headline (`$`, tokens, context windows, ratio) | `fetchAllWorkspaceTotals` → `computeSavingsHeadline` (`@megasaver/stats`) |
| Overview readiness (5 checks) | `fetchClaudeHookStatus`, `fetchProxyStatus`, `fetchMcpStatus`, `fetchDaemonStatus`, `fetchWorkspaceIndex` |
| Overview "Live now" | `fetchClaudeSessions` filtered to live |
| Sessions + grouping | `fetchClaudeSessions`, `groupSessionsByCwd` |
| Cockpit transcript / telemetry / tasks | `openClaudeSessionStream`, `fetchClaudeSessionTelemetry`, `fetchSessionTasks` |
| Cockpit savings rail | `fetchSessionTokenSaverStats` |
| Token saver — hook switch | `fetchClaudeHookStatus`, `connect/disconnectClaudeHook` |
| Token saver — proxy switch | `fetchProxyStatus`, `setProxy` |
| Token saver — Safe/Balanced/Aggressive | `fetchWorkspaceSaver`, `setWorkspaceSaver` |
| Token saver — daemon row | `fetchDaemonStatus` |
| Workspace — 4 tabs | `fetchWorkspaceIndex`, `…Rules`, `…Tools`, `…Permissions` |
| Memory — notes CRUD | `fetchSessionMemory`, `create/patch/deleteSessionMemory` |
| Memory — knowledge graph | `fetchSessionMemoryGraph` |
| Memory — decision trace | `fetchDecisionTraceGraph` |
| Agent office — roster, status, tasks, activity | `fetchAgents`, `fetchOfficeStatus`, `assignTask`, `controlAgent`, `fetchAudit`, `openOfficeStream` |
| Setup rows | `fetchMcpStatus`, `install/repair/uninstallMcp` |
| ⌘K palette, toast, theme toggle | frontend-only, no data |

### Omitted — no backing route (user decision, 2026-07-28)

Building these would mean new bridge endpoints, Zod boundary schemas, new
`BridgeErrorCode` members, and store-root work — a materially larger,
non-frontend change. Deliberately **not** shipped, and not faked:

1. **18-day savings sparkline.** No daily time-series route exists.
   Already recorded as deferred in `wiki/entities/gui.md` (GUI Redesign v3).
2. **Cross-workspace "Recent saver activity" feed.** `fetchSessionTokenSaverEvents`
   is per-session; there is no global feed.
3. **Memory "Live brain"** — working-set strength bars, learned/reinforced/faded
   stream, "Consolidate now". No `brain` route in the bridge at all.
4. **Agent office multi-floor** (`FLOORS`, `MAX_PER_FLOOR`, add/remove floor)
   and the **per-agent provider picker**. `OfficeAgent` has no `floor` or
   `provider` field. The floor-plan illustration itself **is** built — from
   the real agent roster, as a single floor.

Also dropped as unbacked decoration: the `+18% this week` trend chip, the
per-session "Est. value", the fixed `76k / 200k` context-window gauge, and
the daemon `pid 48213 · uptime 6h 12m` string (only real running state shows).

## 5. Enum surfaces

`VIEW_IDS` gains `"overview"`, staying alphabetically pinned (AA3):
`agent-office, agent-setup, memory, overview, sessions, token-saver, workspace`.
`view-id.test-d.ts` and `VIEW_LABELS` update with it. `NAV_ORDER` becomes a
grouped structure (three sections) rather than a flat list.

`biome.json`'s `useSemanticElements` override previously named five view files,
**all of which had already been deleted** by earlier redesigns — it matched
nothing. It is rescoped to the single file that genuinely needs it,
`components/command-palette.tsx` (`role="dialog"` on a div, because jsdom does
not implement `showModal()`). Everything else uses native semantics: the
workspace dropdown is a plain `<ul>` of `<button>`s (a disclosure, not a
listbox) and the toast is an `<output>`.

## 6. Accessibility commitments

Carried forward unchanged from v1: keyboard-reachable, `focus-visible`
everywhere, `aria-current="page"` on the active nav item, labels on
icon-only controls, `role="status"` on the toast, `role="switch"` +
`aria-checked` on the three saver toggles, `prefers-reduced-motion`
honoured (the office typing/bob animations must stop under it).

The command palette is a modal dialog: `role="dialog"`, `aria-modal`, Escape
closes, focus moves to the input on open, **Tab is trapped inside it** (a bare
`aria-modal` tells AT the background is inert while the keyboard disagrees), and
focus returns to the opener on close (WCAG 2.4.3).

Bridge responses are validated at the boundary before reaching any figure the
user reads. `fetchAllWorkspaceTotals` is an unchecked cast, so `isUsableTotals`
gates it: a malformed body (including `[]`, which is truthy) must degrade to the
honest "no savings recorded yet" state, never render `$NaN`. Same rule for
`mcp.agents`. Every surfaced `$` carries `≈`, `(est.)` and `SAVINGS_FOOTNOTE`
from `@megasaver/stats`, so the GUI can never imply more precision than the
model has or drift from the CLI's price constant.

## 7. Risk

MEDIUM. Frontend-only; no bridge, Core, or schema change. Required gates:
`pnpm verify` green, plus a `code-reviewer` pass in a fresh context.
