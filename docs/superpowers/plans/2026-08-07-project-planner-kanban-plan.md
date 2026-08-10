# Project Planner & Execution Board (Hermes Style) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Hermes-style Project Planner and Kanban Execution Board where tasks are stored as Markdown files with YAML frontmatter under `.megasaver/planner/`, providing rich Kanban UI visualization, atomic status directory synchronization, Markdown editor drawers, and Agent Office execution dispatch.

**Architecture:** Core storage engine in `packages/core/src/planner/` manages filesystem operations, atomic subfolder moves (`backlog/`, `todo/`, `in-progress/`, `review/`, `done/`), and YAML frontmatter parsing. The local GUI bridge in `apps/gui/bridge/routes/planner.ts` exposes REST endpoints (`GET /api/planner`, `POST /api/planner/card`, `PATCH /api/planner/card`, `DELETE /api/planner/card`, `POST /api/planner/sync-todo`). The React frontend in `apps/gui/src/views/planner-page.tsx` provides interactive 5-column Kanban drag-and-drop, priority filter pills, tag filtering, a slide-over Markdown card detail drawer, and Agent Office integration.

**Tech Stack:** TypeScript (ESM, strict), React 18, Zod, Vitest, Citty, Biome, Turborepo.

## Global Constraints

- Node 22 LTS pinned (`.nvmrc`).
- TypeScript strict, ESM only (`moduleResolution: NodeNext`).
- File system permissions: POSIX `0700` directories, `0600` files.
- Atomic writes: write to temporary path with random UUID prefix, then rename.
- Zero-lockout frontmatter fallback: malformed frontmatter degrades to fallback metadata based on filename and directory.
- Monorepo gate: `pnpm verify` (linting, typechecking, full test suite) must pass 100%.

---

### Task 1: Core Planner Schemas & Frontmatter Parser

**Files:**
- Create: `packages/core/src/planner/schema.ts`
- Create: `packages/core/src/planner/parser.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/planner-schema.test.ts`

**Interfaces:**
- Consumes: Zod library
- Produces: `PlannerStatus`, `PlannerPriority`, `PlannerCardFrontmatter`, `PlannerCard`, `PlannerBoard`, `parsePlannerCardMarkdown`, `serializePlannerCardMarkdown`

- [ ] **Step 1: Write failing test for schemas and markdown parser**

Create `packages/core/test/planner-schema.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { parsePlannerCardMarkdown, serializePlannerCardMarkdown } from "../src/planner/parser.js";

describe("planner card schema and markdown parser", () => {
  it("parses valid frontmatter and markdown body correctly", () => {
    const raw = `---
id: "task-01"
title: "Build Kanban Board"
status: "todo"
priority: "high"
tags: ["gui"]
assignedAgent: "builder"
createdAt: "2026-08-07T10:00:00.000Z"
updatedAt: "2026-08-07T10:00:00.000Z"
---
## Description
- [x] Done item
- [ ] Pending item`;

    const parsed = parsePlannerCardMarkdown(raw, ".megasaver/planner/todo/task-01.md", "todo");
    expect(parsed.id).toBe("task-01");
    expect(parsed.title).toBe("Build Kanban Board");
    expect(parsed.status).toBe("todo");
    expect(parsed.priority).toBe("high");
    expect(parsed.tags).toEqual(["gui"]);
    expect(parsed.assignedAgent).toBe("builder");
    expect(parsed.checklist).toEqual({ total: 2, completed: 1 });
  });

  it("falls back gracefully on malformed frontmatter", () => {
    const raw = "Just raw text without frontmatter header";
    const parsed = parsePlannerCardMarkdown(raw, ".megasaver/planner/backlog/my-card.md", "backlog");
    expect(parsed.id).toBe("my-card");
    expect(parsed.status).toBe("backlog");
    expect(parsed.priority).toBe("medium");
    expect(parsed.title).toBe("my-card");
  });

  it("serializes planner card back to markdown with frontmatter", () => {
    const card = {
      id: "task-02",
      title: "Test Task",
      status: "in-progress" as const,
      priority: "critical" as const,
      tags: ["test"],
      assignedAgent: null,
      createdAt: "2026-08-07T10:00:00.000Z",
      updatedAt: "2026-08-07T11:00:00.000Z",
      content: "## Notes\nSome text",
      filePath: ".megasaver/planner/in-progress/task-02.md",
      checklist: { total: 0, completed: 0 },
    };
    const serialized = serializePlannerCardMarkdown(card);
    expect(serialized).toContain('id: "task-02"');
    expect(serialized).toContain('status: "in-progress"');
    expect(serialized).toContain("## Notes");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test test/planner-schema.test.ts`
Expected: FAIL (modules not defined)

- [ ] **Step 3: Implement core schema and parser**

Create `packages/core/src/planner/schema.ts`:
```typescript
import { z } from "zod";

export const PLANNER_STATUSES = ["backlog", "todo", "in-progress", "review", "done"] as const;
export const plannerStatusSchema = z.enum(PLANNER_STATUSES);
export type PlannerStatus = z.infer<typeof plannerStatusSchema>;

export const PLANNER_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export const plannerPrioritySchema = z.enum(PLANNER_PRIORITIES);
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
  tags: z.array(z.string().min(1).max(64)).default([]),
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
  filePath: z.string(),
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

Create `packages/core/src/planner/parser.ts`:
```typescript
import { basename } from "node:path";
import {
  type PlannerCard,
  type PlannerStatus,
  plannerCardFrontmatterSchema,
} from "./schema.js";

function extractChecklist(content: string): { total: number; completed: number } {
  const matches = content.matchAll(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/gm);
  let total = 0;
  let completed = 0;
  for (const m of matches) {
    total += 1;
    if (m[1]?.toLowerCase() === "x") completed += 1;
  }
  return { total, completed };
}

export function parsePlannerCardMarkdown(
  raw: string,
  filePath: string,
  folderStatus: PlannerStatus,
): PlannerCard {
  const fallbackId = basename(filePath, ".md").replace(/[^a-zA-Z0-9_-]/g, "_");
  const now = new Date().toISOString();

  if (raw.startsWith("---")) {
    const endIdx = raw.indexOf("\n---", 3);
    if (endIdx !== -1) {
      const yamlStr = raw.slice(4, endIdx).trim();
      const content = raw.slice(endIdx + 4).trim();
      const lines = yamlStr.split("\n");
      const obj: Record<string, unknown> = {};

      for (const line of lines) {
        const colonIdx = line.indexOf(":");
        if (colonIdx !== -1) {
          const key = line.slice(0, colonIdx).trim();
          let valStr = line.slice(colonIdx + 1).trim();
          if ((valStr.startsWith('"') && valStr.endsWith('"')) || (valStr.startsWith("'") && valStr.endsWith("'"))) {
            valStr = valStr.slice(1, -1);
          }
          if (key === "tags") {
            try {
              obj[key] = JSON.parse(valStr);
            } catch {
              obj[key] = valStr ? valStr.split(",").map((s) => s.trim()) : [];
            }
          } else if (key === "assignedAgent") {
            obj[key] = valStr === "null" || !valStr ? null : valStr;
          } else {
            obj[key] = valStr;
          }
        }
      }

      if (!obj.id) obj.id = fallbackId;
      if (!obj.status) obj.status = folderStatus;
      if (!obj.createdAt) obj.createdAt = now;
      if (!obj.updatedAt) obj.updatedAt = now;

      const parsed = plannerCardFrontmatterSchema.safeParse(obj);
      if (parsed.success) {
        return {
          ...parsed.data,
          content,
          filePath,
          checklist: extractChecklist(content),
        };
      }
    }
  }

  return {
    id: fallbackId,
    title: fallbackId,
    status: folderStatus,
    priority: "medium",
    tags: [],
    assignedAgent: null,
    createdAt: now,
    updatedAt: now,
    content: raw.trim(),
    filePath,
    checklist: extractChecklist(raw),
  };
}

export function serializePlannerCardMarkdown(card: {
  id: string;
  title: string;
  status: PlannerStatus;
  priority: string;
  tags: string[];
  assignedAgent: string | null;
  createdAt: string;
  updatedAt: string;
  content: string;
}): string {
  const frontmatter = [
    "---",
    `id: "${card.id}"`,
    `title: "${card.title}"`,
    `status: "${card.status}"`,
    `priority: "${card.priority}"`,
    `tags: ${JSON.stringify(card.tags)}`,
    `assignedAgent: ${card.assignedAgent ? `"${card.assignedAgent}"` : "null"}`,
    `createdAt: "${card.createdAt}"`,
    `updatedAt: "${card.updatedAt}"`,
    "---",
  ].join("\n");

  return `${frontmatter}\n\n${card.content.trim()}\n`;
}
```

Re-export in `packages/core/src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/core test test/planner-schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/planner/ packages/core/test/planner-schema.test.ts packages/core/src/index.ts
git commit -m "feat(core): add planner card schema and markdown parser"
```

---

### Task 2: Core Planner Service & Storage Operations

**Files:**
- Create: `packages/core/src/planner/service.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/planner-service.test.ts`

**Interfaces:**
- Consumes: `PlannerBoard`, `PlannerCard`, `parsePlannerCardMarkdown`, `serializePlannerCardMarkdown`
- Produces: `ensurePlannerDirectories`, `readPlannerBoard`, `writePlannerCard`, `deletePlannerCard`, `syncRootTodoFile`

- [ ] **Step 1: Write failing test for core planner service**

Create `packages/core/test/planner-service.test.ts`:
```typescript
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deletePlannerCard,
  readPlannerBoard,
  syncRootTodoFile,
  writePlannerCard,
} from "../src/planner/service.js";

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "planner-service-test-"));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe("core planner service", () => {
  it("initializes directories and reads empty board", async () => {
    const board = await readPlannerBoard(projectDir, "ws-test");
    expect(board.columns).toHaveLength(5);
    expect(board.totalCards).toBe(0);
  });

  it("writes card to disk and moves file atomically when status changes", async () => {
    const card1 = await writePlannerCard(projectDir, {
      title: "Initial Task",
      status: "todo",
      priority: "high",
      tags: ["gui"],
      content: "## Description\n- [ ] item 1",
    });

    expect(card1.status).toBe("todo");
    expect(card1.filePath).toContain(".megasaver/planner/todo/");

    const card2 = await writePlannerCard(projectDir, {
      id: card1.id,
      title: "Initial Task",
      status: "in-progress",
      priority: "high",
      tags: ["gui"],
      content: "## Description\n- [x] item 1",
    });

    expect(card2.status).toBe("in-progress");
    expect(card2.filePath).toContain(".megasaver/planner/in-progress/");

    const board = await readPlannerBoard(projectDir, "ws-test");
    expect(board.totalCards).toBe(1);
    const inProgressCol = board.columns.find((c) => c.key === "in-progress");
    expect(inProgressCol?.cards).toHaveLength(1);
  });

  it("deletes a card by moving it to archive", async () => {
    const card = await writePlannerCard(projectDir, {
      title: "Task to delete",
      status: "todo",
      priority: "low",
    });
    await deletePlannerCard(projectDir, card.id);
    const board = await readPlannerBoard(projectDir, "ws-test");
    expect(board.totalCards).toBe(0);
  });

  it("syncs root TODO.md into backlog", async () => {
    writeFileSync(join(projectDir, "TODO.md"), "# TODO\n- [ ] Task from todo.md\n- [x] Completed task\n");
    const { importedCount } = await syncRootTodoFile(projectDir);
    expect(importedCount).toBe(2);
    const board = await readPlannerBoard(projectDir, "ws-test");
    expect(board.totalCards).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test test/planner-service.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement core planner service**

Create `packages/core/src/planner/service.ts`:
```typescript
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  PLANNER_PRIORITIES,
  PLANNER_STATUSES,
  type PlannerBoard,
  type PlannerCard,
  type PlannerCardFrontmatter,
  type PlannerColumn,
  type PlannerPriority,
  type PlannerStatus,
} from "./schema.js";
import { parsePlannerCardMarkdown, serializePlannerCardMarkdown } from "./parser.js";

const STATUS_TITLES: Record<PlannerStatus, string> = {
  backlog: "Backlog",
  todo: "To Do",
  "in-progress": "In Progress",
  review: "Review",
  done: "Done",
};

export function ensurePlannerDirectories(projectRoot: string): Record<PlannerStatus, string> {
  const base = join(projectRoot, ".megasaver", "planner");
  const archive = join(base, "archive");
  if (!existsSync(base)) mkdirSync(base, { recursive: true, mode: 0o700 });
  if (!existsSync(archive)) mkdirSync(archive, { recursive: true, mode: 0o700 });

  const result = {} as Record<PlannerStatus, string>;
  for (const status of PLANNER_STATUSES) {
    const dir = join(base, status);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    result[status] = dir;
  }
  return result;
}

export async function readPlannerBoard(projectRoot: string, workspaceKey: string): Promise<PlannerBoard> {
  const dirs = ensurePlannerDirectories(projectRoot);
  const now = new Date().toISOString();
  const allCards: PlannerCard[] = [];
  const tagsSet = new Set<string>();

  const columns: PlannerColumn[] = PLANNER_STATUSES.map((statusKey) => {
    const dirPath = dirs[statusKey];
    const files = existsSync(dirPath) ? readdirSync(dirPath).filter((f) => f.endsWith(".md")) : [];
    const colCards: PlannerCard[] = [];

    for (const file of files) {
      const fullPath = join(dirPath, file);
      const relPath = relative(projectRoot, fullPath);
      try {
        const raw = readFileSync(fullPath, "utf8");
        const card = parsePlannerCardMarkdown(raw, relPath, statusKey);
        colCards.push(card);
        allCards.push(card);
        for (const t of card.tags) tagsSet.add(t);
      } catch {
        // Skip unreadable files
      }
    }

    colCards.sort((a, b) => {
      const pA = PLANNER_PRIORITIES.indexOf(a.priority as PlannerPriority);
      const pB = PLANNER_PRIORITIES.indexOf(b.priority as PlannerPriority);
      if (pA !== pB) return pB - pA;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    return {
      key: statusKey,
      title: STATUS_TITLES[statusKey],
      cards: colCards,
      count: colCards.length,
    };
  });

  return {
    workspaceKey,
    projectRoot,
    columns,
    totalCards: allCards.length,
    tags: Array.from(tagsSet).sort(),
    updatedAt: now,
  };
}

export async function writePlannerCard(
  projectRoot: string,
  input: {
    id?: string;
    title: string;
    status: PlannerStatus;
    priority: PlannerPriority;
    tags?: string[];
    assignedAgent?: string | null;
    content?: string;
  },
): Promise<PlannerCard> {
  const dirs = ensurePlannerDirectories(projectRoot);
  const now = new Date().toISOString();

  const id = input.id ?? input.title.toLowerCase().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || `task-${randomUUID().slice(0, 8)}`;

  let oldFilePath: string | undefined;
  let oldCreatedAt: string = now;
  for (const st of PLANNER_STATUSES) {
    const probe = join(dirs[st], `${id}.md`);
    if (existsSync(probe)) {
      oldFilePath = probe;
      try {
        const raw = readFileSync(probe, "utf8");
        const parsed = parsePlannerCardMarkdown(raw, relative(projectRoot, probe), st);
        oldCreatedAt = parsed.createdAt;
      } catch {
        // keep fallback
      }
      break;
    }
  }

  const frontmatter: PlannerCardFrontmatter = {
    id,
    title: input.title,
    status: input.status,
    priority: input.priority,
    tags: input.tags ?? [],
    assignedAgent: input.assignedAgent ?? null,
    createdAt: oldCreatedAt,
    updatedAt: now,
  };

  const content = input.content ?? "";
  const serialized = serializePlannerCardMarkdown({ ...frontmatter, content });
  const targetDir = dirs[input.status];
  const targetFile = join(targetDir, `${id}.md`);
  const relPath = relative(projectRoot, targetFile);

  const tmpFile = join(targetDir, `.${id}-${randomUUID().slice(0, 8)}.tmp`);
  writeFileSync(tmpFile, serialized, { mode: 0o600 });
  renameSync(tmpFile, targetFile);

  if (oldFilePath && oldFilePath !== targetFile && existsSync(oldFilePath)) {
    try {
      unlinkSync(oldFilePath);
    } catch {
      // safe ignore
    }
  }

  return parsePlannerCardMarkdown(serialized, relPath, input.status);
}

export async function deletePlannerCard(projectRoot: string, id: string): Promise<void> {
  const dirs = ensurePlannerDirectories(projectRoot);
  const archiveDir = join(projectRoot, ".megasaver", "planner", "archive");

  for (const st of PLANNER_STATUSES) {
    const target = join(dirs[st], `${id}.md`);
    if (existsSync(target)) {
      const archiveTarget = join(archiveDir, `${id}.md`);
      renameSync(target, archiveTarget);
      return;
    }
  }
}

export async function syncRootTodoFile(projectRoot: string): Promise<{ importedCount: number }> {
  let importedCount = 0;
  const candidates = ["TODO.md", "KANBAN.md"];

  for (const cand of candidates) {
    const path = join(projectRoot, cand);
    if (!existsSync(path)) continue;

    const raw = readFileSync(path, "utf8");
    const matches = raw.matchAll(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/gm);

    for (const m of matches) {
      const isDone = m[1]?.toLowerCase() === "x";
      const title = m[2]?.trim();
      if (!title) continue;

      await writePlannerCard(projectRoot, {
        title,
        status: isDone ? "done" : "backlog",
        priority: "medium",
        content: `Imported from ${cand}`,
      });
      importedCount += 1;
    }
  }

  return { importedCount };
}
```

Re-export in `packages/core/src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/core test test/planner-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/planner/ packages/core/test/planner-service.test.ts packages/core/src/index.ts
git commit -m "feat(core): implement core planner storage service and directory manager"
```

---

### Task 3: GUI Bridge Planner API Routes

**Files:**
- Create: `apps/gui/bridge/routes/planner.ts`
- Modify: `apps/gui/bridge/server.ts`
- Test: `apps/gui/test/bridge/planner-route.test.ts`

**Interfaces:**
- Consumes: `readPlannerBoard`, `writePlannerCard`, `deletePlannerCard`, `syncRootTodoFile` from `@megasaver/core`
- Produces: `/api/planner` endpoints (`GET`, `POST /card`, `PATCH /card`, `DELETE /card`, `POST /sync-todo`)

- [ ] **Step 1: Write failing test for bridge planner routes**

Create `apps/gui/test/bridge/planner-route.test.ts`:
```typescript
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handlePlannerRoute } from "../../bridge/routes/planner.js";

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "planner-bridge-test-"));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe("GUI bridge planner routes", () => {
  it("GET /api/planner returns board state", async () => {
    const res = await handlePlannerRoute({
      method: "GET",
      pathname: "/api/planner",
      query: { cwd: projectDir },
      body: null,
    });
    expect(res.status).toBe(200);
    expect(res.json).toHaveProperty("board");
  });

  it("POST /api/planner/card creates a card", async () => {
    const res = await handlePlannerRoute({
      method: "POST",
      pathname: "/api/planner/card",
      query: {},
      body: { cwd: projectDir, title: "Bridge Task", status: "todo", priority: "high" },
    });
    expect(res.status).toBe(200);
    expect((res.json as { card: { title: string } }).card.title).toBe("Bridge Task");
  });

  it("PATCH /api/planner/card updates card and moves status", async () => {
    const createRes = await handlePlannerRoute({
      method: "POST",
      pathname: "/api/planner/card",
      query: {},
      body: { cwd: projectDir, title: "Move Me", status: "todo", priority: "medium" },
    });
    const id = (createRes.json as { card: { id: string } }).card.id;

    const patchRes = await handlePlannerRoute({
      method: "PATCH",
      pathname: "/api/planner/card",
      query: {},
      body: { cwd: projectDir, id, status: "in-progress", priority: "critical" },
    });
    expect(patchRes.status).toBe(200);
    expect((patchRes.json as { card: { status: string } }).card.status).toBe("in-progress");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/gui test test/bridge/planner-route.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement bridge planner routes**

Create `apps/gui/bridge/routes/planner.ts`:
```typescript
import {
  deletePlannerCard,
  readPlannerBoard,
  syncRootTodoFile,
  writePlannerCard,
} from "@megasaver/core";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { z } from "zod";
import type { HandlerResponse } from "../handler.js";

const createCardSchema = z.object({
  cwd: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(["backlog", "todo", "in-progress", "review", "done"]).default("backlog"),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  tags: z.array(z.string()).optional(),
  assignedAgent: z.string().nullable().optional(),
  content: z.string().optional(),
});

const patchCardSchema = z.object({
  cwd: z.string().min(1),
  id: z.string().min(1),
  title: z.string().optional(),
  status: z.enum(["backlog", "todo", "in-progress", "review", "done"]).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  tags: z.array(z.string()).optional(),
  assignedAgent: z.string().nullable().optional(),
  content: z.string().optional(),
});

const deleteCardSchema = z.object({
  cwd: z.string().min(1),
  id: z.string().min(1),
});

export async function handlePlannerRoute(input: {
  method: string;
  pathname: string;
  query: Record<string, string | undefined>;
  body: unknown;
}): Promise<HandlerResponse> {
  const { method, pathname, query, body } = input;

  if (pathname === "/api/planner" && method === "GET") {
    const cwd = query.cwd;
    if (!cwd) return { status: 400, json: { error: "invalid_cwd" } };
    const board = await readPlannerBoard(cwd, encodeWorkspaceKey(cwd));
    return { status: 200, json: { board } };
  }

  if (pathname === "/api/planner/card" && method === "POST") {
    const parsed = createCardSchema.safeParse(body);
    if (!parsed.success) return { status: 400, json: { error: parsed.error.message } };
    const card = await writePlannerCard(parsed.data.cwd, parsed.data);
    return { status: 200, json: { card } };
  }

  if (pathname === "/api/planner/card" && method === "PATCH") {
    const parsed = patchCardSchema.safeParse(body);
    if (!parsed.success) return { status: 400, json: { error: parsed.error.message } };
    const { cwd, id, title, status, priority, ...rest } = parsed.data;
    const board = await readPlannerBoard(cwd, encodeWorkspaceKey(cwd));
    let existingCard: unknown;
    for (const col of board.columns) {
      const match = col.cards.find((c) => c.id === id);
      if (match) {
        existingCard = match;
        break;
      }
    }
    if (!existingCard) return { status: 404, json: { error: "card_not_found" } };

    const ex = existingCard as { title: string; status: any; priority: any; tags: string[]; assignedAgent: string | null; content: string };
    const card = await writePlannerCard(cwd, {
      id,
      title: title ?? ex.title,
      status: status ?? ex.status,
      priority: priority ?? ex.priority,
      tags: rest.tags ?? ex.tags,
      assignedAgent: rest.assignedAgent !== undefined ? rest.assignedAgent : ex.assignedAgent,
      content: rest.content ?? ex.content,
    });
    return { status: 200, json: { card } };
  }

  if (pathname === "/api/planner/card" && method === "DELETE") {
    const parsed = deleteCardSchema.safeParse(body);
    if (!parsed.success) return { status: 400, json: { error: parsed.error.message } };
    await deletePlannerCard(parsed.data.cwd, parsed.data.id);
    return { status: 200, json: { ok: true } };
  }

  if (pathname === "/api/planner/sync-todo" && method === "POST") {
    const parsed = z.object({ cwd: z.string().min(1) }).safeParse(body);
    if (!parsed.success) return { status: 400, json: { error: parsed.error.message } };
    const res = await syncRootTodoFile(parsed.data.cwd);
    return { status: 200, json: res };
  }

  return { status: 404, json: { error: "not_found" } };
}
```

Wire route into `apps/gui/bridge/server.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/gui test test/bridge/planner-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/gui/bridge/routes/planner.ts apps/gui/bridge/server.ts apps/gui/test/bridge/planner-route.test.ts
git commit -m "feat(gui): add bridge HTTP routes for project planner management"
```

---

### Task 4: GUI View ID & Navigation Registration

**Files:**
- Modify: `apps/gui/src/view-id.ts`
- Modify: `apps/gui/src/components/sidebar.tsx`
- Modify: `apps/gui/src/app.tsx`

**Interfaces:**
- Consumes: `VIEW_IDS`, `VIEW_LABELS`
- Produces: Registered `"planner"` view navigation

- [ ] **Step 1: Add `"planner"` to view-id.ts**

Update `apps/gui/src/view-id.ts`:
```typescript
export const VIEW_IDS = [
  "agent-office",
  "agent-setup",
  "memory",
  "overview",
  "planner",
  "sessions",
  "token-saver",
  "workspace",
] as const;
export type ViewId = (typeof VIEW_IDS)[number];

export const VIEW_LABELS: Record<ViewId, string> = {
  "agent-office": "Agent office",
  "agent-setup": "Setup",
  memory: "Memory",
  overview: "Overview",
  planner: "Project planner",
  sessions: "Sessions",
  "token-saver": "Token saver",
  workspace: "Workspace",
};
```

- [ ] **Step 2: Add nav button to sidebar.tsx & routing to app.tsx**

Update `apps/gui/src/components/sidebar.tsx` to include `planner` nav entry.
Update `apps/gui/src/app.tsx` to render `PlannerPage` when `activeView === "planner"`.

- [ ] **Step 3: Run GUI test suite to verify no navigation breaks**

Run: `pnpm --filter @megasaver/gui test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/gui/src/view-id.ts apps/gui/src/components/sidebar.tsx apps/gui/src/app.tsx
git commit -m "feat(gui): register planner view ID and sidebar navigation"
```

---

### Task 5: Frontend Kanban Board & Column Components

**Files:**
- Create: `apps/gui/src/views/planner-page.tsx`
- Create: `apps/gui/src/components/planner/kanban-grid.tsx`
- Create: `apps/gui/src/components/planner/kanban-column.tsx`
- Create: `apps/gui/src/components/planner/kanban-card.tsx`
- Test: `apps/gui/test/views/planner-page.test.tsx`

**Interfaces:**
- Consumes: `/api/planner` bridge routes
- Produces: `PlannerPage` view component with 5 status columns, drag/drop status moves, filter bar

- [ ] **Step 1: Write failing test for PlannerPage UI**

Create `apps/gui/test/views/planner-page.test.tsx`:
```typescript
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlannerPage } from "../../src/views/planner-page.js";

describe("PlannerPage view component", () => {
  it("renders header and 5 Kanban status columns", () => {
    render(<PlannerPage cwd="/synthetic/path" />);
    expect(screen.getByText("Project planner")).toBeDefined();
    expect(screen.getByText("Backlog")).toBeDefined();
    expect(screen.getByText("To Do")).toBeDefined();
    expect(screen.getByText("In Progress")).toBeDefined();
    expect(screen.getByText("Review")).toBeDefined();
    expect(screen.getByText("Done")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/gui test test/views/planner-page.test.tsx`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement Kanban components**

Implement `KanbanCard`, `KanbanColumn`, `KanbanGrid`, and `PlannerPage` with:
- Priority pills (`critical`: red, `high`: orange, `medium`: blue, `low`: gray)
- Tag list pills
- Checklist count badges (`2/5`)
- Quick move buttons (`←` and `→`) to transition card status
- HTML5 Drag & Drop event handlers

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/gui test test/views/planner-page.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/gui/src/views/planner-page.tsx apps/gui/src/components/planner/ apps/gui/test/views/planner-page.test.tsx
git commit -m "feat(gui): implement 5-column Kanban board grid and card components"
```

---

### Task 6: Slide-Over Markdown Card Drawer Component

**Files:**
- Create: `apps/gui/src/components/planner/card-drawer.tsx`
- Modify: `apps/gui/src/views/planner-page.tsx`
- Test: `apps/gui/test/components/card-drawer.test.tsx`

**Interfaces:**
- Consumes: Selected `PlannerCard` object
- Produces: Slide-over drawer component with live Markdown text editor, checklist toggles, metadata controls

- [ ] **Step 1: Write failing test for CardDrawer**

Create `apps/gui/test/components/card-drawer.test.tsx`:
```typescript
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CardDrawer } from "../../src/components/planner/card-drawer.js";

describe("CardDrawer component", () => {
  it("renders card title, priority select, and content editor", () => {
    const card = {
      id: "c1",
      title: "Drawer Test Task",
      status: "todo" as const,
      priority: "high" as const,
      tags: ["gui"],
      assignedAgent: null,
      createdAt: "2026-08-07T00:00:00Z",
      updatedAt: "2026-08-07T00:00:00Z",
      content: "## Description\n- [ ] check 1",
      filePath: ".megasaver/planner/todo/c1.md",
      checklist: { total: 1, completed: 0 },
    };

    render(<CardDrawer card={card} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByDisplayValue("Drawer Test Task")).toBeDefined();
    expect(screen.getByText("Description")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/gui test test/components/card-drawer.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement CardDrawer component**

Implement slide-over drawer with:
- Title input & Status dropdown
- Priority selector & Tag input bar
- Assigned agent dropdown
- Tabbed view: "Edit Markdown" textarea vs "Preview" Markdown renderer
- Interactive checklist checkboxes

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/gui test test/components/card-drawer.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/gui/src/components/planner/card-drawer.tsx apps/gui/test/components/card-drawer.test.tsx
git commit -m "feat(gui): add slide-over markdown detail drawer for planner tasks"
```

---

### Task 7: Agent Office Integration & Execution Dispatch

**Files:**
- Create: `apps/gui/src/components/planner/agent-office-launch-modal.tsx`
- Modify: `apps/gui/src/components/planner/card-drawer.tsx`
- Test: `apps/gui/test/components/agent-office-launch-modal.test.tsx`

**Interfaces:**
- Consumes: Card data + Agent Office API (`/api/office/task`)
- Produces: "Launch Agent Task" trigger button and modal dispatch

- [ ] **Step 1: Implement Agent Office launch modal**

Add a button "Launch Agent Task" on the card drawer when status is `in-progress`.
When clicked, opens modal confirming role assignment and dispatches prompt to Agent Office.

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @megasaver/gui test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/gui/src/components/planner/agent-office-launch-modal.tsx apps/gui/src/components/planner/card-drawer.tsx
git commit -m "feat(gui): integrate agent office task launching from planner cards"
```

---

### Task 8: Full Monorepo Verification & DoD Gate

- [ ] **Step 1: Run full verification gate**

Run: `pnpm verify`
Expected: 0 lint errors, 0 type errors, 100% test pass across 60 Turbo tasks.

- [ ] **Step 2: Sync conventions and commit final feature**

Run: `pnpm conventions:check`
Expected: PASS
