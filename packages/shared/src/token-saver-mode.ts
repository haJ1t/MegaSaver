import { z } from "zod";

// Order: alphabetic per AA3 (aggressive → safe). Closed enum;
// new modes are added by spec only. Members chosen so that the
// budget assigned by modeToBudget below grows monotonically from
// aggressive → safe — the budget map and the schema co-evolve.
export const tokenSaverModeSchema = z.enum(["aggressive", "balanced", "safe"]);

export type TokenSaverMode = z.infer<typeof tokenSaverModeSchema>;

// Byte budget per mode. Locked in AA1 spec §11d / §4a. Caller code
// (BB5 output-filter, BB10 GUI panel) treats this as authoritative;
// per-session overrides via Session.tokenSaver.maxReturnedBytes are
// still capped at 2 * modeToBudget("safe") downstream (AA1 §8a).
export function modeToBudget(mode: TokenSaverMode): number {
  switch (mode) {
    case "aggressive":
      return 4_000;
    case "balanced":
      return 12_000;
    case "safe":
      return 32_000;
  }
}
