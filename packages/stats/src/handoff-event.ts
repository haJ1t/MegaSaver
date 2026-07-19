import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProjectId } from "@megasaver/shared";
import { projectIdSchema } from "@megasaver/shared";
import { z } from "zod";
import { StatsError } from "./errors.js";

// Advisory ledger for `mega handoff` pack/open runs. Deliberately NOT a
// TokenSaverEvent: these are usage counts, not byte-savings measurements —
// mixing them would poison the honest savings pipeline (warm-start precedent).
export const handoffEventSchema = z
  .object({
    id: z.string().min(1),
    projectId: projectIdSchema,
    kind: z.enum(["pack", "open"]),
    targetAgent: z.string().min(1),
    memories: z.number().int().nonnegative(),
    failures: z.number().int().nonnegative(),
    redactionFindings: z.number().int().nonnegative(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type HandoffEvent = z.infer<typeof handoffEventSchema>;

type StoreRoot = { root: string };

function handoffEventsPath(store: StoreRoot, projectId: ProjectId): string {
  return join(store.root, "stats", projectId, "handoff.events.jsonl");
}

export function appendHandoffEvent(store: StoreRoot, event: HandoffEvent): void {
  const parsed = handoffEventSchema.safeParse(event);
  if (!parsed.success) {
    throw new StatsError("schema_invalid");
  }
  const path = handoffEventsPath(store, parsed.data.projectId);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(parsed.data)}\n`);
}

export function readHandoffEvents(store: StoreRoot, projectId: ProjectId): HandoffEvent[] {
  const path = handoffEventsPath(store, projectId);
  if (!existsSync(path)) return [];
  const events: HandoffEvent[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = handoffEventSchema.safeParse(raw);
    if (parsed.success) events.push(parsed.data);
  }
  return events;
}
