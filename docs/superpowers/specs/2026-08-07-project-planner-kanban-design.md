# Project Planner & Execution Board (Hermes Style) Exhaustive Specification

> **Risk Level:** MEDIUM  
> **Status:** Draft / Ultra-Detailed Specification (2026-08-07)  
> **Packages Touched:** `@megasaver/core`, `@megasaver/gui`, `apps/gui/bridge`  

---

## 1. Overview & Architectural Philosophy

Mega Saver is the ContextOps platform for frontier coding agents (Claude Code, Codex, Cursor, Aider). To provide project-level execution visibility, task tracking, and agent orchestration similar to Hermes Agent, Mega Saver requires a dedicated **Project Planner & Execution Board**.

### Non-Negotiable System Principles
1. **Workspace-Native Storage:** All board state, task cards, and settings are stored directly in the active project directory under `.megasaver/planner/`. No SQLite, no cloud databases, and no external third-party dependencies are required for storage.
2. **Dual Human/Machine Readability:** Tasks are stored as Markdown (`.md`) files with YAML frontmatter. Developers can read/edit them via standard text editors, IDEs, or Git diffs, while agents can inspect and manipulate them via structured schemas.
3. **Atomic Folder & Metadata Synchronisation:** Column status transitions on the Kanban board (e.g., *Todo* -> *In Progress*) atomically move the underlying `.md` file between status subdirectories (`.megasaver/planner/todo/task.md` -> `.megasaver/planner/in-progress/task.md`) while updating the YAML frontmatter `status` property in a single fs-sync operation.
4. **Zero-Lockout Resiliency:** If a card file contains malformed YAML frontmatter or raw prose, the planner service must not crash or exclude the file. It falls back gracefully to extracting default metadata from the filename, parent directory, and file creation mtime.
5. **Agent Office Synergy:** Tasks can be assigned to pre-seeded agent roles (`claude-code`, `architect`, `builder`, `reviewer`). Selecting "Launch Agent Task" on an *In Progress* card dispatches the task into MegaSaver Agent Office with the card content as context.

---

## 2. Directory & File System Layout

Planner data is scoped to each project workspace and resides inside `<project-root>/.megasaver/planner/`:

```
<project-root>/
└── .megasaver/
    └── planner/
        ├── settings.json                   # Board configuration & custom column settings
        ├── archive/                        # Archived / deleted cards (retained for history)
        ├── backlog/                        # Status: "backlog"
        │   └── 01-context-firewall.md
        ├── todo/                           # Status: "todo"
        │   └── 02-kanban-gui.md
        ├── in-progress/                    # Status: "in-progress"
        │   └── 03-bridge-routes.md
        ├── review/                         # Status: "review"
        │   └── 04-pr-review.md
        └── done/                           # Status: "done"
            └── 00-initial-spec.md
```

### Status Columns & Directory Definitions

| Status Key | Display Name | Subdirectory Path | Description / Workflow Phase |
|---|---|---|---|
| `backlog` | Backlog | `.megasaver/planner/backlog/` | Unscheduled ideas, feature requests, and raw notes |
| `todo` | To Do | `.megasaver/planner/todo/` | Scheduled tasks prioritized for immediate implementation |
| `in-progress` | In Progress | `.megasaver/planner/in-progress/` | Active development tasks currently being worked on |
| `review` | Review | `.megasaver/planner/review/` | Completed code pending PR review, test checks, or verification |
| `done` | Done | `.megasaver/planner/done/` | Fully implemented, verified, and merged tasks |

### Settings File Schema (`.megasaver/planner/settings.json`)
```json
{
  "version": 1,
  "columns": ["backlog", "todo", "in-progress", "review", "done"],
  "customTags": ["gui", "core", "bug", "feature", "security"],
  "autoArchiveDoneAfterDays": null
}
```

---

## 3. Data Schemas & TypeScript Contracts

### 3.1 Card File Structure (`.md`)

Each task card (e.g. `.megasaver/planner/todo/02-kanban-gui.md`) uses standard YAML frontmatter delimiting a Markdown body:

```markdown
---
id: "02-kanban-gui"
title: "Add Kanban GUI Component"
status: "todo"
priority: "high"
tags: ["gui", "feature"]
assignedAgent: "builder"
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

### 3.2 Zod Schemas & TypeScript Types (`packages/core/src/planner/schema.ts`)

```typescript
import { z } from "zod";

export const PLANNER_STATUSES = [
  "backlog",
  "todo",
  "in-progress",
  "review",
  "done",
] as const;

export const plannerStatusSchema = z.enum(PLANNER_STATUSES);
export type PlannerStatus = z.infer<typeof plannerStatusSchema>;

export const PLANNER_PRIORITIES = [
  "low",
  "medium",
  "high",
  "critical",
] as const;

export const plannerPrioritySchema = z.enum(PLANNER_PRIORITIES);
export type PlannerPriority = z.infer<typeof plannerPrioritySchema>;

export const plannerCardIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/, "Card ID must contain only alphanumeric, hyphen, or underscore characters");

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

export const plannerChecklistSchema = z.object({
  total: z.number().int().min(0),
  completed: z.number().int().min(0),
});
export type PlannerChecklist = z.infer<typeof plannerChecklistSchema>;

export const plannerCardSchema = plannerCardFrontmatterSchema.extend({
  content: z.string(),
  filePath: z.string(), // Relative path: .megasaver/planner/<status>/<id>.md
  checklist: plannerChecklistSchema,
});
export type PlannerCard = z.infer<typeof plannerCardSchema>;

export const plannerColumnSchema = z.object({
  key: plannerStatusSchema,
  title: z.string(),
  cards: z.array(plannerCardSchema),
  count: z.number().int().min(0),
});
export type PlannerColumn = z.infer<typeof plannerColumnSchema>;

export const plannerBoardSchema = z.object({
  workspaceKey: z.string(),
  projectRoot: z.string(),
  columns: z.array(plannerColumnSchema),
  totalCards: z.number().int().min(0),
  tags: z.array(z.string()),
  updatedAt: z.string().datetime({ offset: true }),
});
export type PlannerBoard = z.infer<typeof plannerBoardSchema>;
```

---

## 4. Core Domain Service Specification (`packages/core/src/planner/`)

### 4.1 Module Exports (`packages/core/src/planner/index.ts`)

1. **`ensurePlannerDirectories(projectRoot: string): Promise<Record<PlannerStatus, string>>`**
   - Validates `projectRoot`.
   - Creates `.megasaver/planner/` and all 5 status subfolders (`backlog`, `todo`, `in-progress`, `review`, `done`) along with `archive/` using POSIX `0700` directory permissions.

2. **`readPlannerCardFile(fullPath: string, relativePath: string, statusFromFolder: PlannerStatus): Promise<PlannerCard>`**
   - Reads UTF-8 content from disk.
   - Extracts YAML frontmatter. If parsing fails:
     - Fallback `id`: filename without extension.
     - Fallback `title`: first header line or formatted filename.
     - Fallback `status`: `statusFromFolder`.
     - Fallback `priority`: `"medium"`.
     - Fallback `createdAt` / `updatedAt`: `stat.birthtime.toISOString()`.
   - Extracts Markdown task checkboxes via regex: `/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/gm`.
   - Returns validated `PlannerCard` object.

3. **`readPlannerBoard(projectRoot: string, workspaceKey: string): Promise<PlannerBoard>`**
   - Ensures planner directory structure.
   - Iterates through each status folder in `PLANNER_STATUSES` order.
   - Reads all `.md` files in parallel, sorting cards within each column by `priority` (critical -> high -> medium -> low) and then by `updatedAt` descending.
   - Collects unique tags across all cards for the board filter bar.
   - Returns aggregated `PlannerBoard`.

4. **`writePlannerCard(projectRoot: string, input: { id?: string; title: string; status: PlannerStatus; priority: PlannerPriority; tags?: string[]; assignedAgent?: string | null; content?: string }): Promise<PlannerCard>`**
   - Sanitizes and validates card `id` (generates slug from `title` if omitted).
   - Determines existing card location by scanning `.megasaver/planner/*/<id>.md`.
   - Serializes frontmatter + content using standard YAML separator (`---\n...`).
   - If card exists and `status` changed:
     - Writes new file to `.megasaver/planner/<newStatus>/<id>.md` using atomic write (`wx` write to temp + rename).
     - Deletes old file at `.megasaver/planner/<oldStatus>/<id>.md`.
   - If new card or same status:
     - Atomically writes to `.megasaver/planner/<status>/<id>.md`.
   - Returns updated `PlannerCard`.

5. **`deletePlannerCard(projectRoot: string, id: string): Promise<void>`**
   - Scans status subdirectories for `<id>.md`.
   - Moves file to `.megasaver/planner/archive/<id>.md` (overwriting existing archive if present).

6. **`syncRootTodoFile(projectRoot: string): Promise<{ importedCount: number }>`**
   - Scans `<project-root>/TODO.md` and `<project-root>/KANBAN.md`.
   - Extracts task items (`- [ ] ...` or `- [x] ...`).
   - Converts un-imported items into new cards under `.megasaver/planner/backlog/` (or `done/` if `[x]`).

---

## 5. GUI Bridge API Endpoints (`apps/gui/bridge/routes/planner.ts`)

All endpoints are hosted under `/api/planner/*` on the local GUI bridge server and require authorization via token.

### 5.1 Route Handlers & Contracts

#### 1. `GET /api/planner`
- **Query Params:** `cwd` (string, required — path to project workspace).
- **Behavior:** Resolves workspace, calls `readPlannerBoard`.
- **Response 200:** `{ board: PlannerBoard }`
- **Response 400:** `{ error: "invalid_cwd" }`

#### 2. `POST /api/planner/card`
- **Request Body:**
  ```json
  {
    "cwd": "/path/to/project",
    "title": "Implement context pruner",
    "status": "todo",
    "priority": "high",
    "tags": ["core", "pruning"],
    "assignedAgent": "builder",
    "content": "## Goal\nPrune context files effectively."
  }
  ```
- **Response 200:** `{ card: PlannerCard }`

#### 3. `PATCH /api/planner/card`
- **Request Body:**
  ```json
  {
    "cwd": "/path/to/project",
    "id": "task-02-kanban-gui",
    "status": "in-progress",
    "priority": "critical",
    "content": "Updated body content..."
  }
  ```
- **Behavior:** Updates frontmatter/content, performs atomic folder move if `status` changed.
- **Response 200:** `{ card: PlannerCard }`
- **Response 404:** `{ error: "card_not_found" }`

#### 4. `DELETE /api/planner/card`
- **Request Body:** `{ "cwd": "/path/to/project", "id": "task-02-kanban-gui" }`
- **Response 200:** `{ ok: true }`

#### 5. `POST /api/planner/sync-todo`
- **Request Body:** `{ "cwd": "/path/to/project" }`
- **Response 200:** `{ importedCount: 4 }`

---

## 6. Frontend GUI Specification (`apps/gui/src/`)

### 6.1 View Registration & Navigation
- **`apps/gui/src/view-id.ts`:**
  Add `"planner"` to `VIEW_IDS`. Update `VIEW_LABELS` with `"planner": "Project planner"`.
- **`apps/gui/src/components/sidebar.tsx`:**
  Add nav entry under workspace section with Kanban icon (`LayoutKanban` from lucide-react or inline SVG).

### 6.2 Component Hierarchy & State Management

```
PlannerPage (apps/gui/src/views/planner-page.tsx)
├── PlannerHeader
│   ├── SearchInput (live text query filter)
│   ├── PriorityFilter (All | Critical | High | Medium | Low)
│   ├── TagFilterBar (Pill buttons for custom tags)
│   ├── AgentFilter (All | Claude Code | Architect | Builder | Reviewer)
│   ├── SyncTodoButton ("Sync TODO.md")
│   └── NewCardButton ("+ New Task")
├── KanbanGrid (apps/gui/src/components/planner/kanban-grid.tsx)
│   ├── KanbanColumn (backlog)
│   ├── KanbanColumn (todo)
│   ├── KanbanColumn (in-progress)
│   ├── KanbanColumn (review)
│   └── KanbanColumn (done)
│       └── KanbanCard (apps/gui/src/components/planner/kanban-card.tsx)
│           ├── PriorityBadge (color-coded)
│           ├── TagList
│           ├── ChecklistProgress (e.g. "2/5 done")
│           ├── AssignedAgentPill
│           └── CardActions (Move Left, Move Right, Edit, Delete)
└── CardDrawer (apps/gui/src/components/planner/card-drawer.tsx)
    ├── DrawerHeader (Editable title, Status select, Close button)
    ├── MetadataBar (Priority dropdown, Tag multi-select, Assigned Agent)
    ├── EditorTabs (Edit Mode vs Markdown Preview)
    ├── LiveMarkdownTextarea (Card body editor)
    ├── ChecklistInteractive (Clickable task checkboxes)
    └── AgentOfficeBridgeButton ("Launch Agent Task for this Card")
```

### 6.3 Drag-and-Drop & Transition Interaction
- HTML5 Drag & Drop API:
  - `KanbanCard` attaches `draggable` and `onDragStart={(e) => e.dataTransfer.setData("text/plain", card.id)}`.
  - `KanbanColumn` handles `onDragOver={(e) => e.preventDefault()}` and `onDrop={(e) => handleDrop(statusKey, e.dataTransfer.getData("text/plain"))}`.
  - On drop, dispatches `PATCH /api/planner/card` with new `status`. Optimistic UI update re-renders column immediately while API request resolves.

---

## 7. Agent Office Integration (`mega agent office`)

Cards in the *In Progress* column featuring an assigned agent (`assignedAgent`: `"builder"` or `"claude-code"`) display an active **"Launch Agent Task"** trigger button inside the `CardDrawer`.

When clicked:
1. Constructs an agent prompt payload:
   ```json
   {
     "roleId": card.assignedAgent,
     "title": card.title,
     "prompt": "Task: " + card.title + "\n\n" + card.content,
     "contextFiles": [card.filePath]
   }
   ```
2. Dispatches task creation to Agent Office (`POST /api/office/task`), transitioning card state and launching the autonomous agent worker.

---

## 8. Test & Verification Plan

### 8.1 Unit Tests (`packages/core/test/planner.test.ts`)
- Test directory initialization and creation under `.megasaver/planner/`.
- Test `readPlannerBoard` on populated directories with valid and malformed frontmatter.
- Test atomic file movement between status directories on `writePlannerCard` status change.
- Test deleting card moves file to `archive/`.
- Test `syncRootTodoFile` parses checkboxes from `TODO.md`.

### 8.2 Bridge Route Integration Tests (`apps/gui/test/bridge/planner-route.test.ts`)
- `GET /api/planner` returns 200 with structured board object.
- `POST /api/planner/card` creates `.md` file on disk with 0600 mode and valid frontmatter.
- `PATCH /api/planner/card` updates frontmatter, moves file across subfolders, and verifies old location is empty.
- `DELETE /api/planner/card` returns 200 and removes card from active board.

### 8.3 React Component Tests (`apps/gui/test/views/planner-page.test.tsx`)
- Render `PlannerPage` with mock board state.
- Verify column rendering, priority badge coloring, and search filtering.
- Test drawer open/close on card click and saving content changes.

### 8.4 Definition of Done Gate
- Monorepo validation: `pnpm verify` (linting, typechecking, full test suite across 30+ packages) completes with 0 errors.
