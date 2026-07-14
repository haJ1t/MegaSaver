import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProjectId } from "@megasaver/shared";
import { projectIdSchema } from "@megasaver/shared";
import { z } from "zod";
import { StatsError } from "./errors.js";

// Code-Truth analytics ledger (i6 spec §10). Deliberately NOT a
// TokenSaverEvent: avoidedTokens is an ESTIMATE of the demoted memory's token
// size, never a measured byte-savings — mixing them would poison the honest
// savings pipeline. Append-only: one row per pre-recall spot-check demotion.
export const codeTruthEventSchema = z
  .object({
    type: z.literal("stale-recall-avoided"),
    id: z.string().uuid(),
    projectId: projectIdSchema,
    sessionId: z.string().min(1),
    memoryId: z.string().min(1),
    avoidedTokens: z.number().int().nonnegative(),
    estimated: z.literal(true),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type CodeTruthEvent = z.infer<typeof codeTruthEventSchema>;

type StoreRoot = { root: string };

function codeTruthEventsPath(store: StoreRoot, projectId: ProjectId): string {
  return join(store.root, "stats", projectId, "code-truth.events.jsonl");
}

export function appendCodeTruthEvent(store: StoreRoot, event: CodeTruthEvent): void {
  const parsed = codeTruthEventSchema.safeParse(event);
  if (!parsed.success) {
    throw new StatsError("schema_invalid");
  }
  const path = codeTruthEventsPath(store, parsed.data.projectId);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(parsed.data)}\n`);
}

export function readCodeTruthEvents(store: StoreRoot, projectId: ProjectId): CodeTruthEvent[] {
  const path = codeTruthEventsPath(store, projectId);
  if (!existsSync(path)) return [];
  const events: CodeTruthEvent[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = codeTruthEventSchema.safeParse(raw);
    if (parsed.success) events.push(parsed.data);
  }
  return events;
}
