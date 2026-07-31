import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TelemetryValidationError } from "../src/errors.js";
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

  it("stampWorkspaceTelemetry throws TelemetryValidationError with missing_workspace_path when workspacePath is empty", () => {
    try {
      stampWorkspaceTelemetry(
        { id: "evt_1" },
        { workspacePath: "", storeRoot: tmpBase, liveSessionId: "sess_1" },
      );
      expect.unreachable("should have thrown TelemetryValidationError");
    } catch (err) {
      expect(err).toBeInstanceOf(TelemetryValidationError);
      expect((err as TelemetryValidationError).code).toBe("missing_workspace_path");
    }
  });

  it("stampWorkspaceTelemetry throws TelemetryValidationError with missing_store_root when storeRoot is empty", () => {
    try {
      stampWorkspaceTelemetry(
        { id: "evt_1" },
        { workspacePath: "/Users/test/repo", storeRoot: "", liveSessionId: "sess_1" },
      );
      expect.unreachable("should have thrown TelemetryValidationError");
    } catch (err) {
      expect(err).toBeInstanceOf(TelemetryValidationError);
      expect((err as TelemetryValidationError).code).toBe("missing_store_root");
    }
  });

  it("stampWorkspaceTelemetry throws TelemetryValidationError with missing_session_id when liveSessionId is missing (no dummy fallbacks)", () => {
    try {
      stampWorkspaceTelemetry(
        { id: "evt_1" },
        { workspacePath: "/Users/test/repo", storeRoot: tmpBase, liveSessionId: "" },
      );
      expect.unreachable("should have thrown TelemetryValidationError");
    } catch (err) {
      expect(err).toBeInstanceOf(TelemetryValidationError);
      expect((err as TelemetryValidationError).code).toBe("missing_session_id");
    }
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

    const stamped = stampWorkspaceTelemetry({ id: "evt_456", liveSessionId: "sess_payload_99" }, {
      workspacePath: cwd,
      storeRoot: tmpBase,
    } as unknown as TelemetryOptions);

    expect(stamped.liveSessionId).toBe("sess_payload_99");
  });
});
