import { z } from "zod";

export const ON_DEMAND_ALLOWLIST = [
  "output:filter",
  "output:file",
  "output:chunk",
  "output:exec",
  "context:why",
  "context:hotspots",
  "context:yield",
  "context:build",
  "context:audit",
  "context:explain",
  "preflight:snapshot",
  "preflight:diff",
  "sessions:live",
  "doctor",
  "sweep:scan",
  "inspect",
  "deja-vu",
  "audit",
  "version",
] as const;

export type OnDemandCmd = (typeof ON_DEMAND_ALLOWLIST)[number];

export const onDemandCmdSchema = z.enum(ON_DEMAND_ALLOWLIST);

const ALLOW_SET = new Set<string>(ON_DEMAND_ALLOWLIST as readonly string[]);

export function isOnDemandAllowed(cmd: string): boolean {
  return ALLOW_SET.has(cmd);
}
