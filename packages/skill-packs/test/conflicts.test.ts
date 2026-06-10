import { describe, expect, it } from "vitest";
import { scanSkillIdConflicts } from "../src/conflicts.js";
import type { DiscoveredPack } from "../src/discover.js";

function pack(name: string, skillIds: string[]): DiscoveredPack {
  return {
    manifest: {
      name,
      version: "1.0.0",
      kind: "skill",
      skills: skillIds.map((id) => ({ id, entry: `skills/${id}.md` })),
      capabilities: [],
      description: null,
    },
    root: `/fake/${name}`,
    source: "workspace",
  };
}

describe("scanSkillIdConflicts", () => {
  it("returns empty for disjoint skill ids", () => {
    expect(scanSkillIdConflicts([pack("a", ["x"]), pack("b", ["y"])])).toEqual([]);
  });

  it("reports a conflict with both pack names", () => {
    const conflicts = scanSkillIdConflicts([pack("a", ["x"]), pack("b", ["x", "y"])]);
    expect(conflicts).toEqual([{ skillId: "x", packs: ["a", "b"] }]);
  });

  it("a single pack repeating its own id is not a cross-pack conflict", () => {
    expect(scanSkillIdConflicts([pack("a", ["x", "x"])])).toEqual([]);
  });
});
