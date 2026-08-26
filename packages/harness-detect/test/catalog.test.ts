import { agentIdSchema } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { HARNESS_CATALOG, type HarnessCategory } from "../src/catalog.js";

describe("HARNESS_CATALOG invariants", () => {
  it("ships exactly 39 harnesses (the researched 2026 popular set)", () => {
    expect(HARNESS_CATALOG).toHaveLength(39);
  });

  it("has unique ids", () => {
    const ids = HARNESS_CATALOG.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every id is a valid AgentId (agent-agnostic closed set stays the single source)", () => {
    for (const h of HARNESS_CATALOG) {
      expect(agentIdSchema.safeParse(h.id).success, h.id).toBe(true);
    }
  });

  it("categories come from the closed set and are grouped cli → ide → extension", () => {
    const order: readonly HarnessCategory[] = ["cli", "ide", "extension"];
    let lastRank = -1;
    for (const h of HARNESS_CATALOG) {
      expect(order).toContain(h.category);
      const rank = order.indexOf(h.category);
      expect(rank, `${h.id} out of category order`).toBeGreaterThanOrEqual(lastRank);
      lastRank = rank;
    }
  });

  it("every harness carries at least one detection signal", () => {
    for (const h of HARNESS_CATALOG) {
      const signalCount =
        h.binaries.length + h.configDirs.length + h.extensionDirs.length + h.projectMarkers.length;
      expect(signalCount, h.id).toBeGreaterThan(0);
    }
  });

  it("connectorTargetId and coveredByTargetId are never both set", () => {
    for (const h of HARNESS_CATALOG) {
      expect(h.connectorTargetId === null || h.coveredByTargetId === null, h.id).toBe(true);
    }
  });

  it("the user-named harnesses (deepseek, cursor, openclaw, hermes) are present", () => {
    const ids = new Set(HARNESS_CATALOG.map((h) => h.id));
    expect(ids.has("deepseek")).toBe(true);
    expect(ids.has("cursor")).toBe(true);
    expect(ids.has("openclaw")).toBe(true);
    expect(ids.has("hermes")).toBe(true);
  });

  it("the AGENTS.md family folds onto the codex target", () => {
    const covered = HARNESS_CATALOG.filter((h) => h.coveredByTargetId === "codex").map((h) => h.id);
    expect(covered).toEqual(["goose", "crush", "amp", "iflow", "droid", "warp", "zed"]);
  });

  it("every harness with a dedicated target maps to the documented 16-target set", () => {
    const dedicated = [
      ...new Set(
        HARNESS_CATALOG.filter((h) => h.connectorTargetId !== null).map((h) => h.connectorTargetId),
      ),
    ].sort();
    expect(dedicated).toEqual([
      "aider",
      "amazon-q",
      "antigravity",
      "claude-code",
      "cline",
      "codex",
      "continue",
      "copilot",
      "cursor",
      "gemini",
      "kilo-code",
      "opencode",
      "qwen",
      "roo-code",
      "trae",
      "windsurf",
    ]);
  });

  it("no detection-only harness leaks a target reference", () => {
    const detectionOnly = HARNESS_CATALOG.filter(
      (h) => h.connectorTargetId === null && h.coveredByTargetId === null,
    ).map((h) => h.id);
    expect(detectionOnly).toEqual([
      "plandex",
      "openclaw",
      "deepseek",
      "hermes",
      "openhands",
      "gptme",
      "grok",
      "bits",
      "tabby",
      "refact",
      "cody",
      "mentat",
      "gpt-engineer",
      "devin",
      "qodo",
      "avante",
    ]);
  });

  it("names are non-empty", () => {
    for (const h of HARNESS_CATALOG) {
      expect(h.name.length).toBeGreaterThan(0);
    }
  });
});
