import { encodeWorkspaceKey } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { createMeshHandle, resolveMeshHandle } from "../src/mesh-handle.js";

describe("mesh-handle (I8 Compliance)", () => {
  it("creates canonical msr://<ws>/<ns>/<hash>#kind handle with I8 workspace & namespace isolation", () => {
    const payload = "export const TOKEN_LIMIT = 4000;";
    const cwd = "/Users/ozger/Desktop/MegaSaver";
    const ns = "sess_run_001";
    const expectedWsKey = encodeWorkspaceKey(cwd);

    const handle = createMeshHandle(cwd, ns, payload, "chunk-set");

    expect(handle.workspaceKey).toBe(expectedWsKey);
    expect(handle.runNamespace).toBe(ns);
    expect(handle.kind).toBe("chunk-set");
    expect(handle.uri).toContain(`msr://${expectedWsKey}/${ns}/`);
    expect(handle.uri).toContain("#chunk-set");
    expect(handle.sizeBytes).toBe(payload.length);

    const store = new Map<string, string>([[handle.uri, payload]]);
    const resolved = resolveMeshHandle(handle.uri, store);
    expect(resolved).toBe(payload);
  });

  it("throws an Error if workspacePath or runNamespace is missing (I8 enforcement)", () => {
    expect(() => createMeshHandle("", "ns_1", "payload")).toThrow(
      "createMeshHandle requires a non-empty workspacePath",
    );
    expect(() => createMeshHandle("/path", "", "payload")).toThrow(
      "createMeshHandle requires a non-empty runNamespace",
    );
  });
});
