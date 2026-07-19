import type { KeyObject } from "node:crypto";
import { checkEntitlement } from "@megasaver/entitlement";
import { PRO_ANALYTICS_URL } from "../savings/index.js";

export const HANDOFF_UPSELL = `Hot handoff is a Mega Saver Pro feature. Activate a key: mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}.`;

export type HandoffGateInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  stdout: (line: string) => void;
};

export function gate(input: HandoffGateInput): boolean {
  const ent = checkEntitlement("hot-handoff", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(HANDOFF_UPSELL);
    return false;
  }
  return true;
}

// Count capped at 5 digits (99999h ≈ 11.4y): unbounded counts overflow the
// Date range and toISOString throws instead of a clean flag error.
const EXPIRES_PATTERN = /^([1-9]\d{0,4})([hd])$/;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// Mirrors core's agentSlugSchema (handoff-packet.ts): serializeHandoffPacket
// validates the manifest, so a non-slug --from throws inside the packer — reject
// it at the CLI boundary for a clean error instead of an uncaught ZodError.
export function isAgentSlug(value: string): boolean {
  return value.length <= 64 && /^[a-z0-9][a-z0-9-]*$/.test(value);
}

// null = malformed flag; the caller owns the exit-1 message (runCache --days precedent).
export function parseExpires(raw: string | undefined, now: number): number | null {
  if (raw === undefined) return now + DAY_MS;
  const match = EXPIRES_PATTERN.exec(raw);
  if (match === null) return null;
  const [, count, unit] = match;
  if (count === undefined || unit === undefined) return null;
  return now + Number.parseInt(count, 10) * (unit === "h" ? HOUR_MS : DAY_MS);
}
