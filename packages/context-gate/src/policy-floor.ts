import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { TokenSaverMode } from "@megasaver/shared";
import { z } from "zod";

// Committed, repo-local mode floor (D19): a HIGH-risk repo can veto
// evidence-dropping compression regardless of what the operator's store
// records say. "aggressive" is not a valid floor - it would clamp nothing.
const policyFileSchema = z.object({ modeFloor: z.enum(["balanced", "safe"]).optional() }).strict();

export type PolicyModeFloor = "balanced" | "safe";

const MODE_RANK: Record<TokenSaverMode, number> = { aggressive: 0, balanced: 1, safe: 2 };

export function clampModeToFloor(mode: TokenSaverMode, floor: PolicyModeFloor): TokenSaverMode {
  return MODE_RANK[mode] >= MODE_RANK[floor] ? mode : floor;
}

// Walks cwd -> fs root collecting EVERY readable .megasaver/policy.json and
// returns the STRICTEST floor found (strictest-wins). A nested or floorless
// ({}) or malformed file can therefore only make preservation stricter, never
// weaker — a lower/empty nested policy can never disable or relax an ancestor
// floor (D19 evidence-preservation: the floor cannot be bypassed by a nested
// file). Malformed/unreadable files are skipped (fail-open; doctor surfacing is
// wave-4/E22). Bounded walk (32) mirrors probeLegacyRoot; $HOME-ancestor policy
// only ever RAISES the floor, so ancestor bleed is safe-direction.
export function readPolicyModeFloor(cwd: string): PolicyModeFloor | null {
  let dir = resolve(cwd);
  let strictest: PolicyModeFloor | null = null;
  for (let i = 0; i < 32; i++) {
    try {
      const parsed = policyFileSchema.safeParse(
        JSON.parse(readFileSync(join(dir, ".megasaver", "policy.json"), "utf8")),
      );
      if (parsed.success && parsed.data.modeFloor !== undefined) {
        const floor = parsed.data.modeFloor;
        if (strictest === null || MODE_RANK[floor] > MODE_RANK[strictest]) strictest = floor;
      }
    } catch {
      /* absent or unreadable -> keep walking */
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return strictest;
}
