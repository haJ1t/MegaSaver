import { describe, expect, it } from "vitest";
import type { ClaudeSessionMeta } from "../../bridge/claude-sessions/types.js";
import {
  encodeWorkspaceKey,
  groupSessionsByWorkspace,
} from "../../bridge/claude-sessions/workspace.js";

const meta = (over: Partial<ClaudeSessionMeta>): ClaudeSessionMeta => ({
  dir: "-d",
  id: "i",
  mtimeMs: 0,
  size: 0,
  title: "t",
  projectLabel: "/x",
  isArchived: false,
  model: "",
  permissionMode: "",
  lastActivityAt: 0,
  ...over,
});

describe("encodeWorkspaceKey", () => {
  it("is a 16-char lowercase hex, deterministic", () => {
    const k = encodeWorkspaceKey("/Users/me/proj");
    expect(k).toMatch(/^[0-9a-f]{16}$/);
    expect(encodeWorkspaceKey("/Users/me/proj")).toBe(k);
  });
  it("differs for different cwds and survives unicode/spaces", () => {
    expect(encodeWorkspaceKey("/a")).not.toBe(encodeWorkspaceKey("/b"));
    expect(encodeWorkspaceKey("/Users/me/proj with space/π")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("groupSessionsByWorkspace", () => {
  it("groups sessions by cwd, recent-first, counts members", () => {
    const ws = groupSessionsByWorkspace([
      meta({ id: "a", projectLabel: "/p", mtimeMs: 100 }),
      meta({ id: "b", projectLabel: "/p", mtimeMs: 300 }),
      meta({ id: "c", projectLabel: "/q", mtimeMs: 200 }),
      meta({ id: "d", projectLabel: "", mtimeMs: 999 }),
    ]);
    expect(ws.map((w) => w.label)).toEqual(["/p", "/q"]);
    const p = ws.find((w) => w.label === "/p");
    expect(p?.sessionCount).toBe(2);
    expect(p?.lastActivityMs).toBe(300);
    expect(p?.key).toBe(encodeWorkspaceKey("/p"));
  });

  it("drops cwd-less sessions entirely", () => {
    const ws = groupSessionsByWorkspace([meta({ id: "x", projectLabel: "", mtimeMs: 50 })]);
    expect(ws).toEqual([]);
  });
});
