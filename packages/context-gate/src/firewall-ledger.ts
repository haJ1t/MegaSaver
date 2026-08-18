import { appendFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

// Value-free by construction (F-FW-1): there is no field for matched text and
// .strict() rejects any extra. Only detector names and occurrence counts.
export const firewallEventSchema = z
  .object({
    at: z.string().datetime(),
    // APPEND-ONLY kind enum (cross-pair contract): earlier members never move;
    // generated-file-fence appends fence-warn/fence-deny after these.
    kind: z.enum([
      "blocked-read",
      "redacted",
      "observed",
      "unknown-package",
      "typosquat-suspect",
      "fence-warn",
      "fence-deny",
    ]),
    detector: z.string().min(1),
    count: z.number().int().positive(),
    sourcePath: z.string().optional(),
    projectId: z.string().optional(),
    sessionId: z.string().optional(),
    // F-FW-1: bounded to package-name grammar charset — free text cannot
    // enter the ledger.
    packageName: z
      .string()
      .max(214)
      .regex(/^[@A-Za-z0-9][A-Za-z0-9._/~-]{0,213}$/)
      .optional(),
    ecosystem: z.enum(["npm", "pypi"]).optional(),
    suggestion: z
      .string()
      .max(214)
      .regex(/^[@A-Za-z0-9][A-Za-z0-9._/~-]{0,213}$/)
      .optional(),
  })
  .strict();
export type FirewallEvent = z.infer<typeof firewallEventSchema>;

// The CLI collectors filter on this so pro-analytics' closed FirewallEventInput
// union stays untouched (same pattern as the generated-file-fence pair).
export const PACKAGE_FIREWALL_KINDS = [
  "unknown-package",
  "typosquat-suspect",
] as const;

export const FENCE_FIREWALL_KINDS = [
  "fence-warn",
  "fence-deny",
] as const;

export function firewallLogPath(storeRoot: string): string {
  return join(storeRoot, "firewall", "events.jsonl");
}

// Best-effort (F-FW-3): auditing must never break the saver pipeline.
export function appendFirewallEvent(storeRoot: string, event: FirewallEvent): void {
  try {
    const path = firewallLogPath(storeRoot);
    mkdirSync(dirname(path), { recursive: true });
    // Opening a FIFO with O_APPEND blocks until a reader appears — the same
    // hang class the local resolver gates against (critic B1).
    if (existsSync(path) && !statSync(path).isFile()) return;
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
