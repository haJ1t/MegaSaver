import type { TokenSaverMode } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import type { UpDetectedState } from "../src/up/detect.js";
import { buildUpPlan, renderUpPlan } from "../src/up/plan.js";

describe("buildUpPlan", () => {
  const baseState: UpDetectedState = {
    settingsPath: "/home/user/.claude/settings.json",
    hooks: {
      kind: "readable",
      changed: true,
      priorConnected: false,
    },
    saver: {
      enabled: false,
      mode: "safe",
    },
    targets: [
      {
        id: "claude-code",
        relativePath: "CLAUDE.md",
        prior: "missing",
        inSync: false,
      },
    ],
  };

  it("plans install for fresh uninstalled state", () => {
    const plan = buildUpPlan(baseState, "balanced");
    expect(plan.hooks.action).toBe("install");
    expect(plan.connector.action).toBe("install");
    expect(plan.saver.action).toBe("install");
    expect(plan.hasWork).toBe(true);
    expect(plan.hasConflict).toBe(false);

    const rendered = renderUpPlan(plan);
    expect(rendered.some((l) => l.includes("hooks") && l.includes("install"))).toBe(true);
    expect(rendered.some((l) => l.includes("CLAUDE.md") && l.includes("install"))).toBe(true);
    expect(rendered.some((l) => l.includes("saver") && l.includes("install"))).toBe(true);
  });

  it("plans ok for completely synced and enabled state with same mode", () => {
    const state: UpDetectedState = {
      ...baseState,
      hooks: {
        kind: "readable",
        changed: false,
        priorConnected: true,
      },
      saver: {
        enabled: true,
        mode: "balanced",
      },
      targets: [
        {
          id: "claude-code",
          relativePath: "CLAUDE.md",
          prior: "block",
          inSync: true,
        },
      ],
    };

    const plan = buildUpPlan(state, "balanced");
    expect(plan.hooks.action).toBe("ok");
    expect(plan.connector.action).toBe("ok");
    expect(plan.saver.action).toBe("ok");
    expect(plan.hasWork).toBe(false);
    expect(plan.hasConflict).toBe(false);
  });

  it("plans repair when drifted (hooks drifted, connector out of sync, saver mode changed)", () => {
    const state: UpDetectedState = {
      ...baseState,
      hooks: {
        kind: "readable",
        changed: true,
        priorConnected: true,
      },
      saver: {
        enabled: true,
        mode: "safe",
      },
      targets: [
        {
          id: "claude-code",
          relativePath: "CLAUDE.md",
          prior: "block",
          inSync: false,
        },
      ],
    };

    const plan = buildUpPlan(state, "balanced");
    expect(plan.hooks.action).toBe("repair");
    expect(plan.connector.action).toBe("repair");
    expect(plan.saver.action).toBe("repair");
    expect(plan.hasWork).toBe(true);
    expect(plan.hasConflict).toBe(false);
  });

  it("plans conflict when settings are unreadable", () => {
    const state: UpDetectedState = {
      ...baseState,
      hooks: {
        kind: "unreadable",
        message: "Syntax error in JSON",
      },
    };

    const plan = buildUpPlan(state, "balanced");
    expect(plan.hooks.action).toBe("conflict");
    expect(plan.hasConflict).toBe(true);
    const rendered = renderUpPlan(plan);
    expect(rendered.some((l) => l.includes("conflict") || l.includes("fix manually"))).toBe(true);
  });
});
