import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isStoreFresh, stampWorkspaceTelemetry } from "../src/workspace-stamp.js";

describe("workspace-stamp (Child-Spec #1 Field Telemetry)", () => {
  const tmpBase = join(process.cwd(), "tmp-test-store-freshness");

  beforeEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
    mkdirSync(tmpBase, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("isStoreFresh returns false (fail-closed) when storeRoot is undefined or invalid", () => {
    expect(isStoreFresh(undefined)).toBe(false);
    expect(isStoreFresh("")).toBe(false);
    expect(isStoreFresh("   ")).toBe(false);
    expect(isStoreFresh(join(tmpBase, "non-existent-dir"))).toBe(false);
  });

  it("isStoreFresh returns true only for an existing directory with no stats or content subdirs", () => {
    expect(isStoreFresh(tmpBase)).toBe(true);

    // Add stats dir -> should become false
    const statsDir = join(tmpBase, "stats");
    mkdirSync(statsDir, { recursive: true });
    expect(isStoreFresh(tmpBase)).toBe(false);
  });

  it("isStoreFresh returns false if content directory exists", () => {
    const contentDir = join(tmpBase, "content");
    mkdirSync(contentDir, { recursive: true });
    expect(isStoreFresh(tmpBase)).toBe(false);
  });

  it("stampWorkspaceTelemetry throws if workspacePath is missing or empty", () => {
    expect(() =>
      stampWorkspaceTelemetry({ id: "evt_1" }, { workspacePath: "", liveSessionId: "sess_1" }),
    ).toThrow("stampWorkspaceTelemetry requires a non-empty workspacePath");
  });

  it("stampWorkspaceTelemetry throws if liveSessionId is missing (no dummy fallbacks)", () => {
    expect(() =>
      stampWorkspaceTelemetry(
        { id: "evt_1" },
        { workspacePath: "/Users/test/repo", liveSessionId: "" },
      ),
    ).toThrow("stampWorkspaceTelemetry requires a valid liveSessionId");
  });

  it("stampWorkspaceTelemetry correctly stamps workspaceKey, liveSessionId, and freshness", () => {
    const cwd = "/Users/ozger/Desktop/MegaSaver";
    const expectedKey = encodeWorkspaceKey(cwd);

    const rawEvent = {
      id: "evt_123",
      sourceKind: "command" as const,
      rawBytes: 1000,
    };

    const stamped = stampWorkspaceTelemetry(rawEvent, {
      workspacePath: cwd,
      storeRoot: tmpBase,
      liveSessionId: "sess_real123",
    });

    expect(stamped.workspaceKey).toBe(expectedKey);
    expect(stamped.liveSessionId).toBe("sess_real123");
    expect(stamped.isFreshStore).toBe(true);
    expect(typeof stamped.createdAt).toBe("string");
    expect(new Date(stamped.createdAt).toISOString()).toBe(stamped.createdAt);
  });

  it("preserves liveSessionId from event payload if not explicitly passed in options", () => {
    const cwd = "/Users/ozger/Desktop/MegaSaver";

    const stamped = stampWorkspaceTelemetry(
      { id: "evt_456", liveSessionId: "sess_payload_99" },
      { workspacePath: cwd, storeRoot: tmpBase },
    );

    expect(stamped.liveSessionId).toBe("sess_payload_99");
  });
});
