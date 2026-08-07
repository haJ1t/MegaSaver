# Project Planner & Execution Board (Hermes Style) Design Spec

> **Risk Level:** MEDIUM  
> **Status:** Approved by user (2026-08-07)  
> **Target:** `@megasaver/gui`, `@megasaver/core`, CLI & GUI Bridge  

---

## 1. Overview & Goals

Mega Saver provides context and session management for frontier coding agents. To support project-level execution and task tracking (similar to Hermes Agent), Mega Saver requires a dedicated, rich **Project Planner & Execution Board**.

### Key Principles
- **File-System First:** All cards, status columns, and board metadata are stored directly in the project directory as human-readable Markdown files with YAML frontmatter under `.megasaver/planner/`.
- **Automatic Synchronisation:** Changing card status on the GUI board atomically moves the corresponding `.md` file into its status subfolder (`backlog/`, `todo/`, `in-progress/`, `review/`, `done/`) and updates frontmatter metadata.
- **Rich Hermes-Style UI:** Responsive 5-column Kanban board with slide-over detail drawer, live Markdown editor, priority badges, tags, and direct integration with MegaSaver Agent Office.

---

## 2. Storage & File System Schema

All planner data lives inside the active project directory under `.megasaver/planner/`:

```
.megasaver/planner/
├── board.json                 # Optional board settings (column order, custom tags)
├── backlog/
│   └── task-01-context-gate.md
├── todo/
│   └── task-02-kanban-gui.md
├── in-progress/
│   └── task-03-bridge-routes.md
├── review/
│   └── task-04-pr-review.md
└── done/
    └── task-00-initial-spec.md
```

### Status Column Mapping
1. `backlog` — Unscheduled ideas & future backlog items
2. `todo` — Scheduled tasks ready for implementation
3. `in-progress` — Currently active implementation tasks
4. `review` — Code under review / verification
5. `done` — Completed and verified tasks

---

## 3. Markdown Card Schema & Frontmatter

Each task file (e.g. `task-02-kanban-gui.md`) follows a strict schema combining YAML frontmatter and Markdown body content:

```markdown
---
id: "task-02-kanban-gui"
title: "Add Kanban GUI Component"
status: "todo"
priority: "high"
tags: ["gui", "feature"]
assignedAgent: "claude-code"
createdAt: "2026-08-07T00:00:00.000Z"
updatedAt: "2026-08-07T00:00:00.000Z"
---

## Goal
Build the Hermes-style Kanban board UI in `apps/gui`.

## Acceptance Criteria
- [ ] Render 5 status columns with item counters
- [ ] Implement slide-over detail drawer with Markdown editor
- [ ] Drag-and-drop & status change moves file between directories
```

### Frontmatter Schema (Zod)
- `id`: `z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/)`
- `title`: `z.string().min(1)`
- `status`: `z.enum(["backlog", "todo", "in-progress", "review", "done"])`
- `priority`: `z.enum(["low", "medium", "high", "critical"])`
- `tags`: `z.array(z.string())`
- `assignedAgent`: `z.string().nullable()`
- `createdAt`: `z.string().datetime({ offset: true })`
- `updatedAt`: `z.string().datetime({ offset: true })`

---

## 4. Backend Core & GUI Bridge Routes

### Core Module (`packages/core/src/planner/`)
- `readPlannerBoard(projectRoot: string): Promise<PlannerBoard>`  
  Scans `.megasaver/planner/` (creates directories if absent), reads and parses frontmatter + content using `gray-matter` or typed header parser, returns structured board object.
- `writePlannerCard(projectRoot: string, card: PlannerCard): Promise<PlannerCard>`  
  Atomically writes/updates frontmatter and body. If `status` changed, moves file from `.megasaver/planner/<oldStatus>/<id>.md` to `.megasaver/planner/<newStatus>/<id>.md`.
- `deletePlannerCard(projectRoot: string, cardId: string): Promise<void>`  
  Removes or moves card file to `.megasaver/planner/archive/`.
- `syncRootTodoFile(projectRoot: string): Promise<PlannerBoard>`  
  Parses legacy `TODO.md` or `KANBAN.md` in project root if present, importing items into `.megasaver/planner/`.

### Bridge Endpoints (`apps/gui/bridge/routes/planner.ts`)
- `GET /api/planner?cwd=<path>` -> `{ board: PlannerBoard }`
- `POST /api/planner/card` -> `{ card: PlannerCard }`
- `PATCH /api/planner/card` -> `{ card: PlannerCard }`
- `DELETE /api/planner/card` -> `{ ok: true }`
- `POST /api/planner/sync-todo` -> `{ importedCount: number }`

---

## 5. Frontend UI Component Architecture (`apps/gui/src/`)

### Navigation & Routing
- Register `"planner"` in `VIEW_IDS` (`view-id.ts`) with label `"Project planner"`.
- Add nav item to `NAV_GROUPS` in `apps/gui/src/components/sidebar.tsx`.

### Main Page (`apps/gui/src/views/planner-page.tsx`)
- Header with search, tag filter, priority filter, "New Card" button, and "Sync TODO.md" action.
- 5 Column Grid (`backlog`, `todo`, `in-progress`, `review`, `done`):
  - Column headers with color-coded badges and item counts.
  - Card Cards displaying title, priority pill (`critical`: red, `high`: orange, `medium`: blue, `low`: gray), tags, assigned agent badge, and check-list progress.
  - Quick action status transition buttons (e.g. Move to In Progress -> Move to Review).
  - Full Drag and Drop support using HTML5 Drag Events.

### Slide-Over Detail Drawer (`apps/gui/src/components/planner/card-drawer.tsx`)
- Opens when clicking any card on the board.
- Live tabbed/split Markdown Editor & Previewer.
- Controls for:
  - Title & Status select dropdown
  - Priority & Tag manager
  - Agent Assignment selector (linked to Agent Office seed roles)
  - "Launch Agent Task" action button (for *In Progress* tasks)

---

## 6. Verification & Test Plan

1. **Unit Tests (`packages/core/test/planner.test.ts`):**
   - Verify reading empty/populated `.megasaver/planner/` directory.
   - Test frontmatter parsing, validation, and missing field fallback.
   - Test atomic file movement between status directories on status update.
2. **Bridge Route Tests (`apps/gui/test/bridge/planner-route.test.ts`):**
   - `GET /api/planner` returns 200 with structured board state.
   - `POST /api/planner/card` creates Markdown file on disk.
   - `PATCH /api/planner/card` moves file on disk and returns updated card.
3. **Frontend Component Tests (`apps/gui/test/views/planner-page.test.tsx`):**
   - Test rendering board columns, card cards, filter interactions, and drawer slide-over.
4. **Validation Gate:**
   - `pnpm verify` (linting, typechecking, full test suite across monorepo) passes 100%.
