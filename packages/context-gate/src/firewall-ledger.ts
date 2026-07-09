import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

// Value-free by construction (F-FW-1): there is no field for matched text and
// .strict() rejects any extra. Only detector names and occurrence counts.
export const firewallEventSchema = z
  .object({
    at: z.string().datetime(),
    kind: z.enum(["blocked-read", "redacted", "observed"]),
    detector: z.string().min(1),
    count: z.number().int().positive(),
    sourcePath: z.string().optional(),
    projectId: z.string().optional(),
    sessionId: z.string().optional(),
  })
  .strict();
export type FirewallEvent = z.infer<typeof firewallEventSchema>;

export function firewallLogPath(storeRoot: string): string {
  return join(storeRoot, "firewall", "events.jsonl");
}

// Best-effort (F-FW-3): auditing must never break the saver pipeline.
export function appendFirewallEvent(storeRoot: string, event: FirewallEvent): void {
  try {
    const path = firewallLogPath(storeRoot);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(event)}\n`);
  } catch {
    // swallowed (F-FW-3)
  }
}

export type FirewallScope = {
  at: string;
  sourcePath?: string;
  projectId?: string;
  sessionId?: string;
};

export type FilterFirewallCounts = {
  findings: ReadonlyArray<{ name: string; count: number }>;
  observed: ReadonlyArray<{ name: string; count: number }>;
};

export function appendFirewallEventsFromFilter(
  storeRoot: string,
  scope: FirewallScope,
  firewall: FilterFirewallCounts | undefined,
): void {
  if (firewall === undefined) return;
  for (const f of firewall.findings) {
    appendFirewallEvent(storeRoot, {
      ...scope,
      kind: "redacted",
      detector: f.name,
      count: f.count,
    });
  }
  for (const o of firewall.observed) {
    appendFirewallEvent(storeRoot, {
      ...scope,
      kind: "observed",
      detector: o.name,
      count: o.count,
    });
  }
}
