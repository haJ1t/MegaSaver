# Mega Saver GUI v3 — Design System

Aesthetic direction: **Editorial Workspace**, now amber-accented. Warm monochrome,
generous whitespace, crisp cards, and typography-led hierarchy, with a persistent
left sidebar replacing the top-nav pill. The previous dense terminal style has
been relaxed to reduce eye strain during long sessions.

---

## Typography

| Token | Value | Use |
|-------|-------|-----|
| `font-sans` | `SF Pro Display`, `Geist Sans`, `Helvetica Neue`, `system-ui`, sans-serif | UI chrome, headings, body |
| `font-mono` | `DM Mono`, `ui-monospace`, `SFMono-Regular`, `Consolas`, monospace | Code, timestamps, metrics, kebab-style meta |
| `text-xs` | 0.75rem / 1rem line-height | Labels, badge text, timestamps |
| `text-sm` | 0.8125rem / 1.25rem | Secondary body, form hints |
| `text-base` | 0.875rem / 1.5rem | Default body |
| `text-lg` | 1rem / 1.5rem | Card titles, cockpit header |
| `text-xl` | 1.125rem / 1.75rem | Page title only |
| `text-4xl` | 2.25rem / 1 | Hero metrics (tokens saved) |
| `font-normal` | 400 | Body text |
| `font-medium` | 500 | Labels, active nav, button text |
| `font-semibold` | 600 | Headings, metric values |

---

## Color tokens

All colors are CSS variables in `src/styles/tokens.css`. Components reference
Tailwind utilities (`bg-surface`, `text-accent`, etc.) — never hardcode hex.

### Light mode

| Variable | Hex | Role |
|----------|-----|------|
| `--color-background` | `#F7F6F3` | Warm page background |
| `--color-surface` | `#FFFFFF` | Cards, panels, list surface |
| `--color-surface-elevated` | `#F0EEEB` | Hover, selected row |
| `--color-text-primary` | `#111111` | Primary text |
| `--color-text-secondary` | `#545968` | Metadata |
| `--color-text-muted` | `#787774` | Placeholders, disabled |
| `--color-border` | `#EAEAEA` | Dividers |
| `--color-accent` | `#B45309` | Primary actions, active sidebar pill |
| `--color-accent-fg` | `#FFF7ED` | Text on accent |
| `--color-danger` | `#9F2F2D` | Destructive actions |
| `--color-danger-fg` | `#FFF0F0` | Text on danger |
| `--color-warn` | `#956400` | Warnings |
| `--color-warn-fg` | `#FFF3DB` | Text on warn |
| `--color-ok` | `#346538` | Success, live status |
| `--color-ok-fg` | `#EDF3EC` | Text on ok |
| `--color-focus-ring` | `#111111` | Focus indicator |

### Dark mode (auto via `prefers-color-scheme: dark`)

| Variable | Hex | Role |
|----------|-----|------|
| `--color-background` | `#0C0D0F` | Warm near-black |
| `--color-surface` | `#141519` | Surface base |
| `--color-surface-elevated` | `#1C1D23` | Elevated / selected |
| `--color-text-primary` | `#F0F1F3` | Body |
| `--color-text-secondary` | `#9EA3AD` | Metadata |
| `--color-text-muted` | `#6E747F` | Muted |
| `--color-border` | `#2A2D35` | Dividers |
| `--color-accent` | `#F59E0B` | Active emphasis (brightened amber) |
| `--color-accent-fg` | `#0C0D0F` | Text on accent |
| `--color-danger` | `#E87171` | Destructive |
| `--color-danger-fg` | `#2A1010` | Text on danger |
| `--color-warn` | `#FBBF24` | Warnings |
| `--color-warn-fg` | `#2A2010` | Text on warn |
| `--color-ok` | `#5EC98A` | Success |
| `--color-ok-fg` | `#0E2018` | Text on ok |
| `--color-focus-ring` | `#F0F1F3` | Focus indicator |

### Spot pastels (status badges only)

| Variable | Background | Foreground | Use |
|----------|------------|------------|-----|
| `--status-live-bg` / `fg` | `#EDF3EC` | `#346538` | Live / connected / ok |
| `--status-active-bg` / `fg` | `#E1F3FE` | `#1F6C9F` | Active / in-progress |
| `--status-warn-bg` / `fg` | `#FBF3DB` | `#956400` | Caution |
| `--status-danger-bg` / `fg` | `#FDEBEF` | `#9F2F2D` | Error / disconnected |
| `--status-muted-bg` / `fg` | `#F0EEEB` | `#545968` | Off / stopped |

Dark variants of the pastel variables are defined in `tokens.css` and accessed
through the same utility classes.

The accent pair (light and dark, text and fill directions) is contrast-pinned
at ≥4.5:1 by `apps/gui/test/styles/accent-contrast.test.ts` — changing an
accent hex without updating that test's expectations will fail the suite.

---

## Information architecture

Six pages, navigated via the persistent `Sidebar`:

1. **Sessions** — home. Summary strip (Workspaces / Sessions / Live counts)
   over the grouped session list; selecting a session opens the slim cockpit.
2. **Token Saver** — global controls (hook connect, proxy activation, daemon
   status) plus per-workspace saver-mode activation.
3. **Memory** — `MemoryPanel` + `MemoryGraphPanel` for the active workspace.
4. **Workspace** — the five workspace panels (index, context, rules, tools,
   permissions) for the active workspace.
5. **Agent Office**
6. **Setup** — `AgentSetupDoctor`.

Memory and the Token Saver page's saver-activation are session-anchored at
the bridge (routes take `dir`/`id`, not a workspace key). A frontend-only
**workspace-context seam** bridges this: `src/lib/workspace-context.ts`
(`deriveWorkspaceOptions`) turns the fetched session list into one option per
`cwd`, each carrying a representative `(dir, id)` — its newest session. The
shared `src/components/workspace-picker.tsx` selector drives all
workspace-scoped pages. This seam is entirely client-side; no bridge route
was added for it.

The home page's summary strip counts Workspaces / Sessions / Live from the
already-fetched session list. A cross-session, cross-workspace token-saved
daily aggregate is **deferred** — no aggregate bridge route exists yet; the
per-session savings figure lives in the cockpit's right rail instead.

---

## Layout

- Page constrained to `max-w-5xl mx-auto` with `px-6` gutters.
- Cards and detail panes use `rounded-xl` (12px) with `1px solid #EAEAEA` borders.
- Vertical rhythm: `gap-4` (16px) inside cards, `gap-6` (24px) between sections.
- Lists are inset inside rounded cards; rows separated by `border-border/50`.

---

## Components

### Navigation

- A persistent left `Sidebar` (`src/components/sidebar.tsx`) replaces the old
  top-nav pill. Fixed width (`w-[220px]`), six items, a "Mega Saver" wordmark
  header, daemon-status footer.
- The active item is a solid amber pill (`bg-accent text-accent-fg`); inactive
  items are text-only with a hover surface.
- Display order (`NAV_ORDER`, sidebar-local) is: Sessions, Token Saver,
  Memory, Workspace, Agent Office, Agent Setup — deliberately decoupled from
  the alphabetic `ViewId`/`VIEW_IDS` tuple pinned in `src/view-id.ts`
  (`agent-office`, `agent-setup`, `memory`, `sessions`, `token-saver`,
  `workspace`). The former `claude-sessions` view id is now `sessions`.
- Cockpit nav (inside a session) still groups related panels under
  dropdowns, now reduced to three: `Transcript`, `Telemetry`, `Tasks`.
  Active group shows a bottom border indicator, not a filled pill.

### Session list

- Workspaces rendered as collapsible sections inside a card.
- Each row shows title + live/idle dot + relative time by default.
- Model and archived status appear on hover or keyboard focus.
- No per-group live dot; only sessions have a live dot.

### Cockpit panels

- Header: text-only "← Back" + stacked title and path.
- The cockpit is slim: session-scoped nav reduced to `Transcript` /
  `Telemetry` / `Tasks` (workspace and memory panels moved out to their own
  top-level pages). Body layout is the active panel beside a fixed-width
  right rail (`~26%`, stacks below on narrow viewports) carrying
  `SessionSaverStats` (`src/cockpit/panels/session-saver-stats.tsx`) — the
  per-session tokens-saved figure, always visible regardless of which panel
  is active.
- Token saver uses a hero metric: large saved-token count with pastel status
  badges (Hook, Saver, Daemon). Controls live under an "Advanced" `<details>`.

---

## Radius

| Class | Value | When to use |
|-------|-------|-------------|
| `rounded-md` | 6px | Buttons, inputs, badges |
| `rounded-lg` / `rounded-xl` | 12px | Cards, panels |
| `rounded-full` | 9999px | Status dots |

---

## Shadows

| Class | When to use |
|-------|-------------|
| `shadow-none` | Default — most surfaces |
| `shadow-sm` | `0 2px 8px rgb(0 0 0 / 0.04)` — dropdowns, subtle lift |

---

## Motion

- Row stagger on list mount: `opacity 0→1` + `translateY(8px)→0`, 40ms stagger,
  400ms `cubic-bezier(0.16, 1, 0.3, 1)`.
- Hover transitions: 150ms color/background changes.
- `prefers-reduced-motion: reduce` → all transitions and animations disabled.

---

## Accessibility commitments

1. Every focusable element receives `:focus-visible` ring via `--color-focus-ring`.
2. Icon-only buttons carry `aria-label`.
3. Error containers use `role="alert"` and receive programmatic focus on mount.
4. Form inputs are associated with `<label>` via `htmlFor`.
5. Cockpit groups use `aria-expanded`, `aria-haspopup="menu"`, and `role="menuitem"`.
6. View switcher preserves `aria-current="page"`.
7. Reduced motion respected globally.
8. No `outline: none` without token-defined replacement.

---

## Migration from v2

- Accent flips black → amber: light `#111111`/`#FFFFFF` → `#B45309`/`#FFF7ED`;
  dark `#F0F1F3`/`#0C0D0F` → `#F59E0B`/`#0C0D0F`. Both pairs contrast-pinned
  ≥4.5:1 by `test/styles/accent-contrast.test.ts`.
- Top-nav pill replaced by a persistent left `Sidebar` (six items, amber
  active pill, daemon footer); nav display order now lives in `NAV_ORDER`,
  decoupled from the alphabetic `VIEW_IDS` type pin. `claude-sessions` view id
  renamed to `sessions`.
- View count grows to six top-level pages: Sessions, Token Saver, Memory,
  Workspace, Agent Office, Setup. Memory and saver-activation gain a
  frontend-only workspace-context seam (`deriveWorkspaceOptions` →
  representative session) since their bridge routes stay session-anchored —
  no bridge route was added.
- The session cockpit slims down: workspace and memory panels move to their
  own top-level pages; the cockpit keeps only Transcript/Telemetry/Tasks plus
  a right rail surfacing `SessionSaverStats`.
- The Sessions home page gains a Workspaces/Sessions/Live summary strip from
  the already-fetched session list; a cross-session daily savings aggregate
  remains deferred (no aggregate bridge route).
