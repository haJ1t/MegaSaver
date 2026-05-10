# Mega Saver GUI v1 — Design System

Aesthetic direction: **Editorial Terminal**. Dense, precise, purposeful developer console.
Zinc base, DM Mono typeface throughout, desaturated amber accent.

---

## Typography

| Token | Value | Use |
|-------|-------|-----|
| Font family | `DM Mono` (Google Fonts, 400 + 500) → `ui-monospace` fallback | All text — no mixed sans stack |
| `text-xs` | 0.75rem / 1rem line-height | Table metadata, badge labels, field labels |
| `text-sm` | 0.8125rem / 1.25rem | Body in dense tables, form inputs |
| `text-base` | 0.875rem / 1.5rem | Default body |
| `text-lg` | 1rem / 1.5rem | Subheadings, detail panel titles |
| `text-xl` | 1.125rem / 1.75rem | Page title only |
| `font-normal` | 400 | All body text |
| `font-medium` | 500 | Labels, active nav, button text |
| `font-semibold` | 600 | Reserved — not used in v1 |

---

## Color tokens

All colors are CSS variables in `src/styles/tokens.css`. Components reference
Tailwind utilities (`bg-surface`, `text-accent`, etc.) — never hardcode hex.

### Light mode

| Variable | Hex | Role |
|----------|-----|------|
| `--color-background` | `#f5f4f2` | Page background |
| `--color-surface` | `#ffffff` | Card, list, detail panel base |
| `--color-surface-elevated` | `#f0ede8` | Selected row, hover, code blocks |
| `--color-text-primary` | `#141519` | Headings, body |
| `--color-text-secondary` | `#545968` | Metadata, timestamps |
| `--color-text-muted` | `#9ea3ad` | Disabled, placeholder, field labels |
| `--color-border` | `#d4d1cb` | Dividers, input borders |
| `--color-accent` | `#c4681a` | Primary action, selected state |
| `--color-accent-fg` | `#ffffff` | Text on accent |
| `--color-danger` | `#b83232` | End session, destructive |
| `--color-danger-fg` | `#fff0f0` | Text on danger |
| `--color-warn` | `#b85e15` | Medium risk badge, warnings |
| `--color-warn-fg` | `#fff3e6` | Text on warn |
| `--color-ok` | `#2c7348` | Open status, success |
| `--color-ok-fg` | `#ebf5ef` | Text on ok |
| `--color-focus-ring` | `#c4681a` | WCAG focus indicator |

### Dark mode (auto via `prefers-color-scheme: dark`)

| Variable | Hex | Role |
|----------|-----|------|
| `--color-background` | `#0c0d0f` | OLED-safe near-black |
| `--color-surface` | `#141519` | Surface base |
| `--color-surface-elevated` | `#1c1d23` | Elevated / selected |
| `--color-text-primary` | `#f0f1f3` | Body |
| `--color-text-secondary` | `#9ea3ad` | Metadata |
| `--color-text-muted` | `#565b66` | Muted |
| `--color-border` | `#2a2d35` | Dividers |
| `--color-accent` | `#e8973a` | Warm amber against zinc |
| `--color-accent-fg` | `#0c0d0f` | Text on accent |
| `--color-danger` | `#dc4f4f` | Destructive |
| `--color-danger-fg` | `#fff0f0` | |
| `--color-warn` | `#d97b2a` | Caution |
| `--color-warn-fg` | `#fff7ed` | |
| `--color-ok` | `#3b8c5a` | Open / success |
| `--color-ok-fg` | `#e8f5ee` | |
| `--color-focus-ring` | `#e8973a` | |

---

## Badge variants

Defined as `@layer utilities` in `tokens.css`. Apply as a single class.

| Class | Semantic meaning |
|-------|-----------------|
| `badge-risk-low` | RiskLevel "low" — muted slate |
| `badge-risk-medium` | RiskLevel "medium" — amber-tinted |
| `badge-risk-high` | RiskLevel "high" — orange-red-tinted |
| `badge-risk-critical` | RiskLevel "critical" — red-tinted |
| `badge-status-open` | Session open — green-tinted |
| `badge-status-ended` | Session ended — muted |
| `badge-scope-project` | MemoryScope "project" — indigo-tinted |
| `badge-scope-session` | MemoryScope "session" — purple-tinted |

Agents (`AgentId`) reuse `badge-risk-low` (muted slate) — they are metadata, not status.

---

## Spacing (4 px base grid)

Pin subset per spec §6c: `0 / 1(4px) / 2(8px) / 3(12px) / 4(16px) / 6(24px) / 8(32px) / 12(48px)`.

---

## Radius

| Class | Value | When to use |
|-------|-------|-------------|
| `rounded-none` | 0 | Table rows, dividers |
| `rounded-sm` | 2px | Badges, pills |
| `rounded-md` | 4px | Buttons, inputs, cards (default) |
| `rounded-lg` | 6px | Code blocks |
| `rounded-full` | 9999px | Dot indicators |

---

## Shadows

| Class | When to use |
|-------|-------------|
| `shadow-none` | Default — most surfaces |
| `shadow-sm` | Subtle card elevation (detail pane if needed) |
| `shadow-md` | Floating listbox (project picker dropdown) |

---

## Motion

- Row stagger on list mount: 120ms `opacity 0→1` per row, 50ms stagger delay.
- Transitions: 150ms for hover color changes, 150ms for tab/button state changes.
- `prefers-reduced-motion: reduce` → all transitions and animations disabled (enforced in `tokens.css` base layer).

---

## Accessibility commitments (spec §9)

1. Every focusable element receives `:focus-visible` ring via `--color-focus-ring`.
2. Icon-only buttons carry `aria-label`.
3. Error containers use `role="alert"` and receive programmatic focus on mount.
4. Form inputs are associated with `<label>` via `htmlFor`.
5. Listboxes use `role="listbox"` + `role="option"` + `aria-selected`.
6. View switcher preserves `aria-current="page"` from v0.3.
7. Reduced motion respected globally.
8. No `outline: none` without token-defined replacement.

---

## Alternatives considered

- **Full serif/sans mixed stack** — rejected. Committing to mono everywhere is the
  one memorable thing: it signals "developer console" from first glance.
- **Modal forms** — rejected in favour of inline expansion in the detail pane.
  Fewer z-layers, Esc key works naturally, no focus trap required for a 3-field form.
- **Purple/blue accent** — rejected as AI slop baseline. Amber reads as "alert/precision"
  in terminal culture without being alarming.
