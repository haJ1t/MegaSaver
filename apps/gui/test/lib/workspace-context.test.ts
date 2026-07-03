import { encodeWorkspaceKey } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import type { ClaudeSessionMeta } from "../../src/lib/claude-sessions-client.js";
import { deriveWorkspaceOptions } from "../../src/lib/workspace-context.js";

function session(over: Partial<ClaudeSessionMeta>): ClaudeSessionMeta {
  return {
    dir: "d",
    id: "i",
    mtimeMs: 0,
    size: 0,
    title: "t",
    projectLabel: "/ws/a",
    isArchived: false,
    model: "m",
    permissionMode: "p",
    lastActivityAt: 0,
    ...over,
  };
}

describe("deriveWorkspaceOptions", () => {
  it("returns one option per cwd, keyed by encodeWorkspaceKey, newest-first", () => {
    const opts = deriveWorkspaceOptions([
      session({ dir: "d1", id: "s1", projectLabel: "/ws/a", mtimeMs: 10 }),
      session({ dir: "d2", id: "s2", projectLabel: "/ws/b", mtimeMs: 30 }),
      session({ dir: "d3", id: "s3", projectLabel: "/ws/a", mtimeMs: 20 }),
    ]);
    expect(opts.map((o) => o.cwd)).toEqual(["/ws/b", "/ws/a"]); // b is newer
    const a = opts.find((o) => o.cwd === "/ws/a");
    expect(a?.key).toBe(encodeWorkspaceKey("/ws/a"));
    expect(a?.label).toBe("a");
    expect(a?.rep).toEqual({ dir: "d3", id: "s3" }); // newest session in /ws/a
  });

  it("returns [] for no sessions", () => {
    expect(deriveWorkspaceOptions([])).toEqual([]);
  });
});
