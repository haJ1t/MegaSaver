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
| `text-xl` | 1.25rem / 1.5rem | Page title only |
| `text-5xl` | 3rem / 1 | Hero metrics (tokens saved) |
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
| `--color-surface-elevated` | `#F9F9F8` | Hover, selected row, input background |
| `--color-text-primary` | `#111111` | Headings, primary body |
| `--color-text-secondary` | `#5E5C58` | Secondary text, metadata |
| `--color-text-muted` | `#A09D98` | Disabled, placeholder, field labels |
| `--color-border` | `#EAEAEA` | Dividers, input borders, card borders |
| `--color-accent` | `#111111` | Active nav pill, primary emphasis |
| `--color-accent-fg` | `#FFFFFF` | Text on accent |
| `--color-danger` | `#B83232` | Destructive actions |
| `--color-danger-fg` | `#FFF0F0` | Text on danger |
| `--color-warn` | `#B85E15` | Warnings |
| `--color-warn-fg` | `#FFF3E6` | Text on warn |
| `--color-ok` | `#2C7348` | Success, live status |
| `--color-ok-fg` | `#EBF5EF` | Text on ok |
| `--color-focus-ring` | `#111111` | Focus indicator |

### Dark mode (auto via `prefers-color-scheme: dark`)

| Variable | Hex | Role |
|----------|-----|------|
| `--color-background` | `#0F0F0E` | Warm near-black |
| `--color-surface` | `#171716` | Surface base |
| `--color-surface-elevated` | `#1E1E1D` | Elevated / selected |
| `--color-text-primary` | `#F0F0EE` | Body |
| `--color-text-secondary` | `#9E9C98` | Metadata |
| `--color-text-muted` | `#5E5D59` | Muted |
| `--color-border` | `#2A2A28` | Dividers |
| `--color-accent` | `#FFFFFF` | Active emphasis |
| `--color-accent-fg` | `#111111` | Text on accent |

### Spot pastels (status badges only)

| Variable | Background | Foreground | Use |
|----------|------------|------------|-----|
| `--status-live-bg` | `#EDF3EC` | `#346538` | Live session dot |
| `--status-info-bg` | `#E1F3FE` | `#1F6C9F` | Info badges |
| `--status-warn-bg` | `#FBF3DB` | `#956400` | Caution badges |
| `--status-error-bg` | `#FDEBEC` | `#9F2F2D` | Error badges |

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
- Each row shows title + relative time by default.
- Model and archived status appear only on hover/focus.
- No per-group live dot; only sessions have a live dot.

### Cockpit panels

- Header: back link + session title + cwd subtitle.
- Token saver uses a hero metric: large saved-token count with supporting
  "Would have used" / "Actually used" mini-metrics.

---

## Radius

| Class | Value | When to use |
|-------|-------|-------------|
| `rounded-md` | 6px | Buttons, inputs, badges |
| `rounded-lg` | 12px | Cards, panels |
| `rounded-xl` | 12px | Primary cards (alias) |
| `rounded-full` | 9999px | Status dots |

---

## Shadows

| Class | When to use |
|-------|-------------|
| `shadow-none` | Default — most surfaces |
| `shadow-sm` | `0 2px 8px rgb(0 0 0 / 0.04)` — dropdowns, subtle lift |

---

## Motion

- Row stagger on list mount: `opacity 0→1` + `translateY(8px→0)`, 40ms stagger.
- Hover transitions: 150ms color/background changes.
- Dropdown: instant appear; no scale/fade required.
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
- Token-saver table replaced by hero-metric layout.
