# GUI Minimalist Redesign — Design Spec

**Date:** 2026-06-26  
**Scope:** `apps/gui` high-clutter surfaces: global tokens/app shell, `WorkspaceSessionList`, `SessionCockpit` chrome, `TokenSaverPanel`. Other screens adopt new tokens but are not restructured in this pass.  
**Risk:** Medium — user-facing visual change, no data mutation.  
**Skill chain:** `minimalist-skill`, `impeccable`, `brainstorming`, `writing-plans`, `test-driven-development`, `verification-before-completion`, `requesting-code-review`.

---

## 1. Problem

The current GUI uses a dense "Editorial Terminal" aesthetic: DM Mono everywhere, small type, heavy borders, and many inline labels/badges. Users report eye strain and difficulty scanning the interface.

## 2. Goal

Transform the selected surfaces into a calm, modern, minimalist workspace that reduces visual noise while preserving all functionality and accessibility.

## 3. Design Direction

**Editorial Workspace** (chosen via visual companion):

- Warm off-white / near-black canvas, not stark white or pure black.
- Clean geometric sans-serif for UI chrome; monospace retained only for code/transcript content.
- Generous whitespace, crisp 1px structural borders, 8–12px radius.
- Spot-pastel status badges; no heavy shadows or gradients.
- Reduce repeated text: fewer badges per row, labels shown on demand, grouped cockpit tabs.

## 4. Scope

### In scope

1. Global tokens in `apps/gui/src/styles/tokens.css` and Tailwind config.
2. `app.tsx` header and nav styling.
3. `views/workspace-session-list.tsx` row/header simplification.
4. `cockpit/session-cockpit.tsx` header and tab grouping.
5. `views/cockpit/token-saver-panel.tsx` metric-first rewrite.
6. Updates to `apps/gui/DESIGN.md` to reflect v2 tokens.

### Out of scope

- Full panel-by-panel cockpit rewrite (transcript, telemetry, memory graph, tasks, etc.) — they inherit token changes only.
- Agent office full redesign — inherits token changes only.
- New icon library or animation framework.
- Dark-mode toggle; still follows OS `prefers-color-scheme`.

## 5. Token Changes

### Typography

- UI font stack: `"SF Pro Display", "Geist Sans", "Helvetica Neue", system-ui, sans-serif`.
- Body line-height: `1.6`.
- Headings: tight tracking `-0.02em`, line-height `1.1`.
- Code/data: keep `DM Mono` / `Geist Mono` for transcript, telemetry numbers, paths.

### Color (light)

| Token | Value | Role |
|-------|-------|------|
| `--color-background` | `#F7F6F3` | Canvas |
| `--color-surface` | `#FFFFFF` | Cards, header, list surface |
| `--color-surface-elevated` | `#F0EEEB` | Hover, selected row |
| `--color-text-primary` | `#111111` | Primary text |
| `--color-text-secondary` | `#545968` | Metadata |
| `--color-text-muted` | `#787774` | Placeholders, disabled |
| `--color-border` | `#EAEAEA` | Dividers |
| `--color-accent` | `#111111` | Primary actions, active nav underline |
| `--color-accent-fg` | `#FFFFFF` | Text on accent |

Spot pastels (badges only):

| Token | Background | Foreground |
|-------|------------|------------|
| `--color-status-live-bg` / `fg` | `#EDF3EC` | `#346538` |
| `--color-status-active-bg` / `fg` | `#E1F3FE` | `#1F6C9F` |
| `--color-status-warn-bg` / `fg` | `#FBF3DB` | `#956400` |
| `--color-status-danger-bg` / `fg` | `#FDEBEC` | `#9F2F2D` |

### Color (dark)

Same roles, tinted toward warm gray:

| Token | Value |
|-------|-------|
| `--color-background` | `#0C0D0F` |
| `--color-surface` | `#141519` |
| `--color-surface-elevated` | `#1C1D23` |
| `--color-text-primary` | `#F0F1F3` |
| `--color-text-secondary` | `#9EA3AD` |
| `--color-text-muted` | `#6E747F` |
| `--color-border` | `#2A2D35` |
| `--color-accent` | `#F0F1F3` |
| `--color-accent-fg` | `#0C0D0F` |

### Radius / Shadows

- Cards: `12px`.
- Buttons/inputs: `6px`.
- Badges/dots: `9999px`.
- Shadows: none by default; optional `0 2px 8px rgba(0,0,0,0.04)` on hover lift.

### Motion

- Mount fade: `opacity 0→1`, `translateY(8px)→0`, `400ms`, `cubic-bezier(0.16, 1, 0.3, 1)`.
- Reduced motion disables all transitions.

## 6. Component Changes

### App shell (`app.tsx`)

- Centered, max-width page container (`max-w-5xl`) with generous top padding.
- Header: "Mega Saver" wordmark + nav pills. Active pill: solid `#111`/white. Inactive: transparent hover.
- Remove the compact full-bleed header bar; use a clean top nav separated by whitespace, not a heavy border.

### Session list (`workspace-session-list.tsx`)

- Wrap list in a rounded white card on warm background.
- Group headers: single line, no live dot (live state shown per session), count right-aligned.
- Session rows: title + live/idle dot + relative time. Model and archived tags hidden by default; show on hover/focus.
- Remove nested borders inside card; only a subtle top border between groups.
- Add staggered fade-in on mount.

### Cockpit shell (`session-cockpit.tsx`)

- Back link as text-only "← Back" with muted color.
- Title + path stacked, larger title.
- Tab bar: replace 11 individual pills with grouped menu buttons:
  - `Transcript`
  - `Memory ▾` (Memory, Memory Graph)
  - `Workspace ▾` (Index, Context, Rules, Tools, Permissions)
  - `Saver`
  - `Tasks`
- Active tab has underline accent, not filled pill.

### Token saver panel (`token-saver-panel.tsx`)

- Single hero metric: total tokens saved.
- Status as small pastel badges (Hook, Saver, Daemon).
- Move explanatory paragraphs into tooltips or an expandable "How it works" section.
- Daemon section collapsed under "Advanced" by default.

## 7. Accessibility

- Preserve focus-visible rings using accent color.
- All icon-only controls keep `aria-label`.
- Color is not the only status indicator (dots + labels).
- `prefers-reduced-motion` disables animations.

## 8. Testing

- Existing tests for `workspace-session-list`, `session-cockpit`, `token-saver-panel` must pass after DOM adjustments.
- Add/update tests for grouped cockpit tab switching.
- No new E2E tests in this pass.

## 9. Migration / Rollout

- Update `apps/gui/DESIGN.md` to v2 tokens and rationale.
- Add changeset for `@megasaver/gui`.
- After merge, remaining panels can be redesigned in follow-up specs without touching tokens again.

## 10. Alternatives Considered

- **Quiet Terminal** — rejected because the mono typeface was identified as a source of fatigue.
- **Compact Dashboard** — rejected because it kept too much density; user wanted less clutter.

---

**Approval:** User confirmed "Editorial Workspace" direction and target mockups via visual companion.
