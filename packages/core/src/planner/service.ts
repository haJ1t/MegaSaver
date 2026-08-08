import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { parsePlannerCardMarkdown, serializePlannerCardMarkdown } from "./parser.js";
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

export async function readPlannerBoard(
  projectRoot: string,
  workspaceKey: string,
): Promise<PlannerBoard> {
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
      // filePath is a portable identifier that crosses the bridge's JSON boundary,
      // never an fs path (every read/write here builds its own join()). POSIX-
      // normalizing keeps it stable across platforms, as every other relative-path
      // emitter in the repo does — indexer/scan.ts, mcp-bridge/get-edit-impact.ts,
      // cli/read-wiki.ts, gui/memory-graph.ts.
      const relPath = relative(projectRoot, fullPath).split(sep).join("/");
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

  const slug = input.title
    .toLowerCase()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "");
  const id = input.id ?? (slug || `task-${randomUUID().slice(0, 8)}`);

  let oldFilePath: string | undefined;
  let oldCreatedAt: string = now;
  for (const st of PLANNER_STATUSES) {
    const probe = join(dirs[st], `${id}.md`);
    if (existsSync(probe)) {
      oldFilePath = probe;
      try {
        const raw = readFileSync(probe, "utf8");
        const relProbe = relative(projectRoot, probe).split(sep).join("/");
        const parsed = parsePlannerCardMarkdown(raw, relProbe, st);
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
  const relPath = relative(projectRoot, targetFile).split(sep).join("/");

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
