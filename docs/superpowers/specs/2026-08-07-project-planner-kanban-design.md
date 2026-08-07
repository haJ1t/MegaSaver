# Project Planner & Execution Board (Hermes Style) Detailed Design Spec

> **Risk Level:** MEDIUM  
> **Status:** Draft / User-Requested Deep Detail Expansion (2026-08-07)  
> **Packages Touched:** `@megasaver/core`, `@megasaver/gui`, `apps/gui/bridge`  

---

## 1. Overview & Architectural Goals

Mega Saver provides context management, memory, and session control for frontier coding agents. To support end-to-end task planning, tracking, and agent execution (similar to Hermes Agent), Mega Saver requires a dedicated **Project Planner & Execution Board**.

### Core Architecture Principles
1. **File-System Authority & Persistence:** All planner state is stored directly in the user’s project workspace under `.megasaver/planner/`. No opaque database or external cloud dependency is used for core task state.
2. **Human & Machine Readability:** Tasks are stored as individual Markdown (`.md`) files with YAML frontmatter headers. They are readable and editable with any text editor or Git workflow, as well as by automated agents.
3. **Atomic File-System Synchronization:** Moving a card between status columns on the Kanban board (e.g. from *Todo* to *In Progress*) atomically moves the underlying `.md` file between status subdirectories (`.megasaver/planner/todo/card-id.md` -> `.megasaver/planner/in-progress/card-id.md`) and updates the `status` property in the frontmatter.
4. **Hermes-Style UI & Agent Office Integration:** A rich 5-column Kanban board in `apps/gui` with a slide-over Markdown editor drawer, checklist progress trackers, priority tags, and direct integration with MegaSaver Agent Office to launch an agent task directly from an "In Progress" card.

---

## 2. Directory Layout & Storage Specification

Planner files live inside the project root directory at `.megasaver/planner/`:

```
<project-root>/
└── .megasaver/
    └── planner/
        ├── settings.json                   # Optional board settings (column order, custom tags)
        ├── archive/                        # Deleted / archived cards
        ├── backlog/                        # Status: "backlog"
        │   └── task-01-context-gate.md
        ├── todo/                           # Status: "todo"
        │   └── task-02-kanban-gui.md
        ├── in-progress/                    # Status: "in-progress"
        │   └── task-03-bridge-routes.md
        ├── review/                         # Status: "review"
        │   └── task-04-pr-review.md
        └── done/                           # Status: "done"
            └── task-00-initial-spec.md
```

### Status Columns & Folder Mappings
| Column Key | Display Label | Subdirectory | Purpose |
|---|---|---|---|
| `backlog` | Backlog | `.megasaver/planner/backlog/` | Unscheduled ideas, future enhancements, and raw specs |
| `todo` | To Do | `.megasaver/planner/todo/` | Prioritized tasks ready for immediate execution |
| `in-progress` | In Progress | `.megasaver/planner/in-progress/` | Active development tasks currently being worked on |
| `review` | Review | `.megasaver/planner/review/` | Code under review, testing, or verifier checks |
| `done` | Done | `.megasaver/planner/done/` | Completed and verified tasks |

---

## 3. Data Schema Specifications

### 3.1 Card Frontmatter & Body Schema (`.md`)

Each task file (e.g. `task-02-kanban-gui.md`) consists of a YAML frontmatter section and a Markdown body:

```markdown
---
id: "task-02-kanban-gui"
title: "Add Kanban GUI Component"
status: "todo"
priority: "high"
tags: ["gui", "feature", "v1.2"]
assignedAgent: "claude-code"
createdAt: "2026-08-07T10:00:00.000Z"
updatedAt: "2026-08-07T12:30:00.000Z"
---

## Objective
Build the Hermes-style Kanban board UI in `apps/gui`.

## Acceptance Criteria
- [x] Render 5 status columns with item counters
- [ ] Implement slide-over detail drawer with live Markdown editor
- [ ] Drag-and-drop & status change moves file between directories
```

### 3.2 Zod Validation Schemas (`packages/core/src/planner/schema.ts`)

```typescript
import { z } from "zod";

export const plannerStatusSchema = z.enum([
  "backlog",
  "todo",
  "in-progress",
  "review",
  "done",
]);
export type PlannerStatus = z.infer<typeof plannerStatusSchema>;

export const plannerPrioritySchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);
export type PlannerPriority = z.infer<typeof plannerPrioritySchema>;

export const plannerCardIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/, "Card ID must be alphanumeric with hyphens or underscores");

export const plannerCardFrontmatterSchema = z.object({
  id: plannerCardIdSchema,
  title: z.string().min(1).max(256),
  status: plannerStatusSchema,
  priority: plannerPrioritySchema,
  tags: z.array(z.string().min(1).max(64)),
  assignedAgent: z.string().nullable().default(null),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type PlannerCardFrontmatter = z.infer<typeof plannerCardFrontmatterSchema>;

export const plannerCardSchema = plannerCardFrontmatterSchema.extend({
  content: z.string(), // Full Markdown body content
  filePath: z.string(), // Relative path from project root
  checklist: z.object({
    total: z.number().int().min(0),
    completed: z.number().int().min(0),
  }),
});
export type PlannerCard = z.infer<typeof plannerCardSchema>;

export const plannerBoardSchema = z.object({
  workspaceKey: z.string(),
  projectRoot: z.string(),
  cards: z.array(plannerCardSchema),
  columns: z.array(
    z.object({
      key: plannerStatusSchema,
      title: z.string(),
      cardIds: z.array(plannerCardIdSchema),
    })
  ),
  updatedAt: z.string().datetime({ offset: true }),
});
export type PlannerBoard = z.infer<typeof plannerBoardSchema>;
```

---

## 4. Core Service & File Operations (`packages/core/src/planner/`)

### Core API Functions

1. **`readPlannerBoard(projectRoot: string): Promise<PlannerBoard>`**
   - Scans `.megasaver/planner/{backlog,todo,in-progress,review,done}/`.
   - Ensures all subdirectories exist (creates missing folders automatically).
   - Reads each `.md` file, parses YAML frontmatter using `gray-matter` or explicit parser, calculates checklist counts (`[x]` vs `[ ]`), and constructs the full `PlannerBoard` state object.
   - Handles corrupted/malformed frontmatter gracefully by logging a warning and extracting default fallback metadata based on filename and directory.

2. **`writePlannerCard(projectRoot: string, input: { card: PlannerCardFrontmatter; content: string }): Promise<PlannerCard>`**
   - Prepares the serialized Markdown string containing YAML frontmatter + content body.
   - Checks if the card already exists in a different status directory.
   - If the `status` has changed:
     - Atomically writes the updated content to `.megasaver/planner/<newStatus>/<id>.md`.
     - Deletes the old file at `.megasaver/planner/<oldStatus>/<id>.md`.
   - If `status` is unchanged, overwrites `.megasaver/planner/<status>/<id>.md` atomically using temp file + rename.

3. **`deletePlannerCard(projectRoot: string, cardId: string): Promise<void>`**
   - Locates card across subdirectories.
   - Moves file to `.megasaver/planner/archive/<cardId>.md` (or unlinks if archive is disabled).

4. **`syncRootTodoFile(projectRoot: string): Promise<{ importedCount: number }>`**
   - Checks for `TODO.md` or `KANBAN.md` in project root.
   - Parses Markdown task checkboxes (`- [ ] Task title`) and creates corresponding new card `.md` files in `.megasaver/planner/backlog/`.

---

## 5. GUI Bridge API Endpoints (`apps/gui/bridge/routes/planner.ts`)

All requests require the project `cwd` parameter or active workspace authorization.

| Endpoint | Method | Input Body / Query | Output JSON | Description |
|---|---|---|---|---|
| `/api/planner` | `GET` | `?cwd=<projectRoot>` | `{ board: PlannerBoard }` | Reads and returns board state |
| `/api/planner/card` | `POST` | `{ cwd, title, status?, priority?, tags?, content? }` | `{ card: PlannerCard }` | Creates a new task card |
| `/api/planner/card` | `PATCH` | `{ cwd, id, title?, status?, priority?, tags?, assignedAgent?, content? }` | `{ card: PlannerCard }` | Updates task frontmatter/body & moves file if status changed |
| `/api/planner/card` | `DELETE` | `{ cwd, id }` | `{ ok: true }` | Archives or deletes card file |
| `/api/planner/sync-todo` | `POST` | `{ cwd }` | `{ importedCount: number }` | Imports tasks from root `TODO.md` |

---

## 6. Frontend GUI Architecture (`apps/gui/src/`)

### 6.1 View Registration & Navigation
- **`view-id.ts`:** Append `"planner"` to `VIEW_IDS` tuple. Label: `"Project planner"`.
- **`sidebar.tsx`:** Include `"planner"` under the workspace navigation group with a Kanban column icon.

### 6.2 Component Tree
```
PlannerPage (apps/gui/src/views/planner-page.tsx)
├── PlannerHeader
│   ├── SearchInput (filter title/content)
│   ├── PriorityFilter (All, Low, Medium, High, Critical)
│   ├── TagFilterBar
│   ├── SyncTodoButton ("Sync TODO.md")
│   └── NewCardButton ("+ New Task")
├── KanbanGrid
│   ├── KanbanColumn (backlog)
│   ├── KanbanColumn (todo)
│   ├── KanbanColumn (in-progress)
│   ├── KanbanColumn (review)
│   └── KanbanColumn (done)
│       └── KanbanCard
│           ├── PriorityBadge
│           ├── TagPills
│           ├── ChecklistProgressBar
│           ├── AssignedAgentPill
│           └── StatusQuickActions (Move Left / Move Right)
└── CardDrawer (apps/gui/src/components/planner/card-drawer.tsx)
    ├── DrawerHeader (Title input, Status select, Close button)
    ├── MetaBar (Priority selector, Tag input, Assigned Agent select)
    ├── EditorTabs (Edit Mode vs Markdown Preview)
    ├── LiveMarkdownEditor (Textarea / CodeMirror for card body)
    ├── ChecklistSection (Interactive checkboxes)
    └── AgentOfficeBridgeButton ("Launch Agent Task for this card")
```

---

## 7. Test & Verification Plan

1. **Core Package Unit Tests (`packages/core/test/planner.test.ts`):**
   - Test directory creation and initialization under `.megasaver/planner/`.
   - Test reading valid frontmatter and fallback on syntax error.
   - Test card update causing atomic file relocation from `todo/` to `in-progress/`.
   - Test root `TODO.md` parsing and card creation.

2. **Bridge Route Integration Tests (`apps/gui/test/bridge/planner-route.test.ts`):**
   - `GET /api/planner` returns correct structured response for a temporary test directory.
   - `POST /api/planner/card` writes file with proper 0600 mode and valid YAML frontmatter.
   - `PATCH /api/planner/card` moves file on disk, updates frontmatter, and verifies file no longer exists in old status dir.

3. **Frontend Component Tests (`apps/gui/test/views/planner-page.test.tsx`):**
   - Render 5 status columns and test filtering by priority/tags.
   - Test drawer opening on card click and saving edits back to backend API.

4. **Repository Monorepo Verification:**
   - Run `pnpm verify` (linting, typechecking, full test suite) and confirm 100% green output.
