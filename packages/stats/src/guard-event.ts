import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProjectId } from "@megasaver/shared";
import { projectIdSchema } from "@megasaver/shared";
import { z } from "zod";
import { StatsError } from "./errors.js";

// Mistake Firewall analytics ledger (spec §3.3). Deliberately NOT a
// TokenSaverEvent: avoidedTokens is an ESTIMATE of the original failure's
// output cost, never a measured byte-savings — mixing them would poison the
// honest savings pipeline. Append-only: outcomes are separate rows referencing
// interceptId; `heeded` = an intercept with no outcome row, computed at read
// time. Never read on the PreToolUse hot path (cooldown lives in guard state).
export const guardEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("intercept"),
      id: z.string().uuid(),
      projectId: projectIdSchema,
      sessionId: z.string().min(1),
      matchedId: z.string().min(1),
      matchedKind: z.enum(["failed-attempt", "auto-capture"]),
      normalizedCommand: z.string().nullable(),
      tier: z.enum(["t1", "t2", "t3"]),
      action: z.enum(["warn", "deny", "recall"]),
      avoidedTokens: z.number().int().nonnegative(),
      estimated: z.literal(true),
      createdAt: z.string().datetime({ offset: true }),
    })
    .strict(),
  z
    .object({
      type: z.literal("outcome"),
      id: z.string().uuid(),
      projectId: projectIdSchema,
      sessionId: z.string().min(1),
      interceptId: z.string().uuid(),
      outcome: z.enum(["overridden-ok", "overridden-failed", "overridden"]),
      createdAt: z.string().datetime({ offset: true }),
    })
    .strict(),
]);

export type GuardEvent = z.infer<typeof guardEventSchema>;

type StoreRoot = { root: string };

function guardEventsPath(store: StoreRoot, projectId: ProjectId): string {
  return join(store.root, "stats", projectId, "guard.events.jsonl");
}

export function appendGuardEvent(store: StoreRoot, event: GuardEvent): void {
  const parsed = guardEventSchema.safeParse(event);
  if (!parsed.success) {
    throw new StatsError("schema_invalid");
  }
  const path = guardEventsPath(store, parsed.data.projectId);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(parsed.data)}\n`);
}

export function readGuardEvents(store: StoreRoot, projectId: ProjectId): GuardEvent[] {
  const path = guardEventsPath(store, projectId);
  if (!existsSync(path)) return [];
  const events: GuardEvent[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = guardEventSchema.safeParse(raw);
    if (parsed.success) events.push(parsed.data);
  }
  return events;
}
