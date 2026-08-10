import { basename } from "node:path";
import { type PlannerCard, type PlannerStatus, plannerCardFrontmatterSchema } from "./schema.js";

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
          if (
            (valStr.startsWith('"') && valStr.endsWith('"')) ||
            (valStr.startsWith("'") && valStr.endsWith("'"))
          ) {
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

      // biome-ignore lint/complexity/useLiteralKeys: noUncheckedIndexedAccess compatibility
      if (!obj["id"]) obj["id"] = fallbackId;
      // biome-ignore lint/complexity/useLiteralKeys: noUncheckedIndexedAccess compatibility
      if (!obj["status"]) obj["status"] = folderStatus;
      // biome-ignore lint/complexity/useLiteralKeys: noUncheckedIndexedAccess compatibility
      if (!obj["createdAt"]) obj["createdAt"] = now;
      // biome-ignore lint/complexity/useLiteralKeys: noUncheckedIndexedAccess compatibility
      if (!obj["updatedAt"]) obj["updatedAt"] = now;

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
