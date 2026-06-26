# Mega Saver GUI v2 — Design System

Aesthetic direction: **Editorial Workspace**. Warm monochrome, generous whitespace,
crisp cards, and typography-led hierarchy. The previous dense terminal style has
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
| `--color-accent` | `#111111` | Primary actions, active nav pill |
| `--color-accent-fg` | `#FFFFFF` | Text on accent |
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
| `--color-accent` | `#F0F1F3` | Active emphasis |
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

---

## Layout

- Page constrained to `max-w-5xl mx-auto` with `px-6` gutters.
- Cards and detail panes use `rounded-xl` (12px) with `1px solid #EAEAEA` borders.
- Vertical rhythm: `gap-4` (16px) inside cards, `gap-6` (24px) between sections.
- Lists are inset inside rounded cards; rows separated by `border-border/50`.

---

## Components

### Navigation

- Global nav uses a single solid pill for the active item (`bg-text-primary text-surface`).
- Cockpit nav groups related panels under dropdowns (`Workspace`, `Memory`).
- Active group shows a bottom border indicator, not a filled pill.

### Session list

- Workspaces rendered as collapsible sections inside a card.
- Each row shows title + live/idle dot + relative time by default.
- Model and archived status appear on hover or keyboard focus.
- No per-group live dot; only sessions have a live dot.

### Cockpit panels

- Header: text-only "← Back" + stacked title and path.
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

## Migration from v1

- Editorial Terminal mono-everywhere aesthetic replaced by sans UI + mono code.
- Zinc/amber palette replaced by warm monochrome with black accent.
- Dense inline lists replaced by rounded cards and grouped tabs.
- Token-saver table replaced by hero-metric layout with pastel badges.
