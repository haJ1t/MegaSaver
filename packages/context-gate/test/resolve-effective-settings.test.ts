import { PolicyLoadError, parseProjectPermissions } from "@megasaver/policy";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import type { OrchestratorRegistry } from "../src/registry-port.js";
import { resolveEffectiveSettings } from "../src/read.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const SESSION_ID = "22222222-2222-4222-8222-222222222222" as SessionId;
const PROJECT_ROOT = "/tmp/demo-root";

function registryWithSession(): OrchestratorRegistry {
  return {
    getSession: (id) =>
      id === SESSION_ID ? { projectId: PROJECT_ID } : null,
    getProject: (id) => (id === PROJECT_ID ? { rootPath: PROJECT_ROOT } : null),
  };
}

const emptyRegistry: OrchestratorRegistry = {
  getSession: () => null,
  getProject: () => null,
};

describe("resolveEffectiveSettings — discriminated result (permissions-yaml §5.1)", () => {
  it("session_not_found when the session is absent", () => {
    const result = resolveEffectiveSettings(emptyRegistry, SESSION_ID, () => null);
    expect(result).toEqual({ ok: false, reason: "session_not_found" });
  });

  it("ok with permissions=null when the loader returns null (absent file)", () => {
    const result = resolveEffectiveSettings(registryWithSession(), SESSION_ID, () => null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.settings.projectRoot).toBe(PROJECT_ROOT);
      expect(result.settings.permissions).toBeNull();
    }
  });

  it("ok with the loaded permissions injected into settings", () => {
    const permissions = parseProjectPermissions({ deny: { commands: ["make"] } });
    const result = resolveEffectiveSettings(
      registryWithSession(),
      SESSION_ID,
      () => permissions,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.settings.permissions).toBe(permissions);
    }
  });

  it("policy_load_failed (NOT a throw) when the loader throws PolicyLoadError (I3)", () => {
    const result = resolveEffectiveSettings(registryWithSession(), SESSION_ID, () => {
      throw new PolicyLoadError("boom");
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("policy_load_failed");
      if (result.reason === "policy_load_failed") {
        expect(result.detail).toContain("boom");
      }
    }
  });

  it("does not load permissions for an absent session (loader never called)", () => {
    let called = false;
    resolveEffectiveSettings(emptyRegistry, SESSION_ID, () => {
      called = true;
      return null;
    });
    expect(called).toBe(false);
  });
});
