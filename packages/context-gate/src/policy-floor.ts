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

// Walks cwd -> fs root for .megasaver/policy.json; first valid file wins.
// Malformed/unreadable files are skipped (fail-open, hook philosophy —
// doctor surfacing is wave-4/E22). Bounded walk mirrors probeLegacyRoot.
export function readPolicyModeFloor(cwd: string): PolicyModeFloor | null {
  let dir = resolve(cwd);
  for (let i = 0; i < 32; i++) {
    try {
      const parsed = policyFileSchema.safeParse(
        JSON.parse(readFileSync(join(dir, ".megasaver", "policy.json"), "utf8")),
      );
      if (parsed.success) return parsed.data.modeFloor ?? null;
    } catch {
      /* absent or unreadable -> keep walking */
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}
