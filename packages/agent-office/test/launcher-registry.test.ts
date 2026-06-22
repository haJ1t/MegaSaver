import type { AgentLauncher, LaunchHandle, LaunchInput } from "@megasaver/connectors-shared";
import { describe, expect, it } from "vitest";
import { AgentOfficeError } from "../src/errors.js";
import { createLauncherRegistry } from "../src/launcher-registry.js";

function fakeLauncher(kind: string): AgentLauncher {
  return {
    kind: kind as AgentLauncher["kind"],
    launch(_input: LaunchInput): LaunchHandle {
      const exitCbs: ((result: { code: number | null }) => void)[] = [];
      return {
        sessionId: "fake-session",
        onEvent() {},
        onExit(cb) {
          exitCbs.push(cb);
        },
        cancel() {},
      };
    },
  };
}

describe("createLauncherRegistry", () => {
  it("returns a launcher by kind", () => {
    const launcher = fakeLauncher("claude-code");
    const registry = createLauncherRegistry([launcher]);
    expect(registry.get("claude-code")).toBe(launcher);
  });

  it("throws launcher_not_registered for unknown kind", () => {
    const registry = createLauncherRegistry([fakeLauncher("claude-code")]);
    expect(() => registry.get("codex" as AgentLauncher["kind"])).toThrow(AgentOfficeError);
    try {
      registry.get("codex" as AgentLauncher["kind"]);
    } catch (err) {
      expect(err).toBeInstanceOf(AgentOfficeError);
      expect((err as AgentOfficeError).code).toBe("launcher_not_registered");
    }
  });

  it("throws on duplicate kind at construction", () => {
    expect(() =>
      createLauncherRegistry([fakeLauncher("claude-code"), fakeLauncher("claude-code")]),
    ).toThrow(AgentOfficeError);
    try {
      createLauncherRegistry([fakeLauncher("claude-code"), fakeLauncher("claude-code")]);
    } catch (err) {
      expect(err).toBeInstanceOf(AgentOfficeError);
      expect((err as AgentOfficeError).code).toBe("launcher_not_registered");
    }
  });

  it("supports multiple distinct kinds", () => {
    const cc = fakeLauncher("claude-code");
    const codex = fakeLauncher("codex");
    const registry = createLauncherRegistry([cc, codex]);
    expect(registry.get("claude-code")).toBe(cc);
    expect(registry.get("codex" as AgentLauncher["kind"])).toBe(codex);
  });
});
