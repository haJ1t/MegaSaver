import { describe, expect, it } from "vitest";
import type { ClaudeSessionMeta } from "../../src/lib/claude-sessions-client.js";
import { groupSessionsByCwd } from "../../src/lib/workspace-grouping.js";

function meta(over: Partial<ClaudeSessionMeta>): ClaudeSessionMeta {
  return {
    dir: "d",
    id: "i",
    mtimeMs: 0,
    size: 0,
    title: "t",
    projectLabel: "/tmp/a",
    isArchived: false,
    model: "",
    permissionMode: "",
    lastActivityAt: 0,
    ...over,
  };
}

describe("groupSessionsByCwd", () => {
  it("returns one group per distinct cwd", () => {
    const groups = groupSessionsByCwd([
      meta({ id: "1", projectLabel: "/tmp/a" }),
      meta({ id: "2", projectLabel: "/tmp/b" }),
      meta({ id: "3", projectLabel: "/tmp/a" }),
    ]);
    expect(groups.map((g) => g.cwd)).toEqual(expect.arrayContaining(["/tmp/a", "/tmp/b"]));
    expect(groups).toHaveLength(2);
  });

  it("orders groups by their newest session mtime desc", () => {
    const groups = groupSessionsByCwd([
      meta({ id: "a-old", projectLabel: "/tmp/a", mtimeMs: 10 }),
      meta({ id: "b-new", projectLabel: "/tmp/b", mtimeMs: 100 }),
    ]);
    expect(groups.map((g) => g.cwd)).toEqual(["/tmp/b", "/tmp/a"]);
  });

  it("sorts sessions within a group by mtime desc", () => {
    const groups = groupSessionsByCwd([
      meta({ id: "old", projectLabel: "/tmp/a", mtimeMs: 1 }),
      meta({ id: "new", projectLabel: "/tmp/a", mtimeMs: 9 }),
      meta({ id: "mid", projectLabel: "/tmp/a", mtimeMs: 5 }),
    ]);
    expect(groups[0]?.sessions.map((s) => s.id)).toEqual(["new", "mid", "old"]);
  });

  it("uses the basename of the cwd as the label", () => {
    const groups = groupSessionsByCwd([meta({ projectLabel: "/Users/me/code/proj" })]);
    expect(groups[0]?.label).toBe("proj");
  });

  it("falls back to the cwd itself when it has no path segment", () => {
    const groups = groupSessionsByCwd([meta({ projectLabel: "(unknown)" })]);
    expect(groups[0]?.label).toBe("(unknown)");
  });

  it("returns an empty array for empty input", () => {
    expect(groupSessionsByCwd([])).toEqual([]);
  });
});
