import { encodeWorkspaceKey } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { createMeshHandle, parseMeshUri, resolveMeshHandle } from "../src/mesh-handle.js";

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
    const resolved = resolveMeshHandle(handle.uri, store, {
      requestedWorkspacePath: cwd,
      requestedRunNamespace: ns,
    });
    expect(resolved).toBe(payload);
  });

  it("rejects resolution (returns null) on workspace_mismatch or namespace_mismatch (I8 resolution guard)", () => {
    const payload = "secret payload";
    const cwd1 = "/Users/ozger/Desktop/MegaSaver";
    const cwd2 = "/Users/ozger/Desktop/OtherProject";
    const ns1 = "sess_1";
    const ns2 = "sess_2";

    const handle = createMeshHandle(cwd1, ns1, payload);
    const store = new Map<string, string>([[handle.uri, payload]]);

    // Mismatched workspace -> null
    const wrongWs = resolveMeshHandle(handle.uri, store, {
      requestedWorkspacePath: cwd2,
      requestedRunNamespace: ns1,
    });
    expect(wrongWs).toBeNull();

    // Mismatched namespace -> null
    const wrongNs = resolveMeshHandle(handle.uri, store, {
      requestedWorkspacePath: cwd1,
      requestedRunNamespace: ns2,
    });
    expect(wrongNs).toBeNull();
  });

  it("parses valid msr:// URIs into components", () => {
    const parsed = parseMeshUri("msr://wsk_abc/sess_123/hash_456#ast-skeleton");
    expect(parsed).toEqual({
      workspaceKey: "wsk_abc",
      runNamespace: "sess_123",
      contentHash: "hash_456",
      kind: "ast-skeleton",
    });
  });

  it("throws an Error if workspacePath or runNamespace is missing at minting time", () => {
    expect(() => createMeshHandle("", "ns_1", "payload")).toThrow(
      "createMeshHandle requires a non-empty workspacePath",
    );
    expect(() => createMeshHandle("/path", "", "payload")).toThrow(
      "createMeshHandle requires a non-empty runNamespace",
    );
  });
});
