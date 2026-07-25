import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectId } from "@megasaver/shared";
import { projectIdSchema } from "@megasaver/shared";
import { z } from "zod";
import { appendPrivateLine } from "./append-line.js";
import { StatsError } from "./errors.js";

// Deliberately NOT a TokenSaverEvent: warm-start numbers are measured brief
// sizes, not byte-savings measurements — mixing them would poison the honest
// savings pipeline. `estimated: true` reserves the future slot for
// counterfactual claims; v1 records measured brief tokens only.
export const warmStartEventSchema = z
  .object({
    id: z.string().min(1),
    projectId: projectIdSchema,
    createdAt: z.string().datetime({ offset: true }),
    mode: z.enum(["micro", "standard", "reonboard"]),
    briefTokens: z.number().int().nonnegative(),
    estimated: z.literal(true),
  })
  .strict();

export type WarmStartEvent = z.infer<typeof warmStartEventSchema>;

type StoreRoot = { root: string };

function warmStartEventsPath(store: StoreRoot, projectId: ProjectId): string {
  return join(store.root, "stats", projectId, "warm-start.events.jsonl");
}

export function appendWarmStartEvent(store: StoreRoot, event: WarmStartEvent): void {
  const parsed = warmStartEventSchema.safeParse(event);
  if (!parsed.success) {
    throw new StatsError("schema_invalid");
  }
  const path = warmStartEventsPath(store, parsed.data.projectId);
  appendPrivateLine(path, `${JSON.stringify(parsed.data)}\n`);
}

export function readWarmStartEvents(store: StoreRoot, projectId: ProjectId): WarmStartEvent[] {
  const path = warmStartEventsPath(store, projectId);
  if (!existsSync(path)) return [];
  const events: WarmStartEvent[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = warmStartEventSchema.safeParse(raw);
    if (parsed.success) events.push(parsed.data);
  }
  return events;
}
