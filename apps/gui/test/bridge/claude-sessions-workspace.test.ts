import { describe, expect, it } from "vitest";
import { encodeWorkspaceKey } from "../../bridge/claude-sessions/workspace.js";

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
