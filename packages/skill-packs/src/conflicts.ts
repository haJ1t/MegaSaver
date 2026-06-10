import type { DiscoveredPack } from "./discover.js";

export type SkillIdConflict = {
  skillId: string;
  packs: string[]; // pack names, in scan order
};

// Pure scan over an EFFECTIVE (name-deduped) set — callers must drop a
// pack being replaced/shadowed before scanning, or --force reinstall
// would self-conflict (spec §2c).
export function scanSkillIdConflicts(packs: readonly DiscoveredPack[]): SkillIdConflict[] {
  const owners = new Map<string, Set<string>>();
  for (const pack of packs) {
    for (const skill of pack.manifest.skills) {
      const set = owners.get(skill.id) ?? new Set<string>();
      set.add(pack.manifest.name);
      owners.set(skill.id, set);
    }
  }
  return [...owners.entries()]
    .filter(([, names]) => names.size > 1)
    .map(([skillId, names]) => ({ skillId, packs: [...names] }));
}
