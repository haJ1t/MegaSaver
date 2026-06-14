import { describe, expect, it } from "vitest";
import { encodeWorkspaceKey, workspaceKeySchema, workspaceLabel } from "../src/workspace-key.js";

const HEX16_RE = /^[0-9a-f]{16}$/;

describe("encodeWorkspaceKey", () => {
  it("returns a 16-char lowercase-hex string", () => {
    const key = encodeWorkspaceKey("/Users/x/proj");
    expect(key).toMatch(HEX16_RE);
  });

  it("is stable for the same cwd", () => {
    expect(encodeWorkspaceKey("/Users/x/proj")).toBe(encodeWorkspaceKey("/Users/x/proj"));
  });

  it("differs for different cwds", () => {
    expect(encodeWorkspaceKey("/Users/x/a")).not.toBe(encodeWorkspaceKey("/Users/x/b"));
  });

  it("handles spaces and unicode", () => {
    const key = encodeWorkspaceKey("/Users/x/é dir");
    expect(key).toMatch(HEX16_RE);
  });
});

describe("workspaceKeySchema", () => {
  it("rejects a non-hex string", () => {
    expect(workspaceKeySchema.safeParse("ABC").success).toBe(false);
  });

  it("accepts a valid 16-hex key", () => {
    expect(workspaceKeySchema.safeParse("0123456789abcdef").success).toBe(true);
  });

  it("rejects an uppercase-hex key", () => {
    expect(workspaceKeySchema.safeParse("0123456789ABCDEF").success).toBe(false);
  });

  it("accepts an encoded key round-trip", () => {
    const key = encodeWorkspaceKey("/Users/x/proj");
    expect(workspaceKeySchema.safeParse(key).success).toBe(true);
  });
});

describe("workspaceLabel", () => {
  it("returns the cwd verbatim", () => {
    expect(workspaceLabel("/Users/x/proj")).toBe("/Users/x/proj");
  });
});
