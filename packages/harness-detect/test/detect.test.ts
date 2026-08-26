import { describe, expect, it } from "vitest";
import { HARNESS_CATALOG } from "../src/catalog.js";
import { type DetectionProbes, detectHarnesses } from "../src/detect.js";

const NO_MATCH: DetectionProbes = {
  binaryExists: () => false,
  homePathExists: () => false,
  extensionDirExists: () => false,
  projectMarkerExists: () => false,
};

describe("detectHarnesses — pure engine", () => {
  it("returns one result per catalog entry, in catalog order", () => {
    const results = detectHarnesses({ probes: NO_MATCH });
    expect(results.map((r) => r.id)).toEqual(HARNESS_CATALOG.map((h) => h.id));
  });

  it("reports absent with zero matched signals when nothing matches", () => {
    const results = detectHarnesses({ probes: NO_MATCH });
    for (const r of results) {
      expect(r.detected).toBe(false);
      expect(r.matchedSignals).toEqual([]);
    }
  });

  it("detects via a PATH binary and records the matched signal honestly", () => {
    const results = detectHarnesses({
      probes: { ...NO_MATCH, binaryExists: (name) => name === "claude" },
    });
    const claude = results.find((r) => r.id === "claude-code");
    expect(claude?.detected).toBe(true);
    expect(claude?.matchedSignals).toEqual([{ kind: "binary", detail: "claude" }]);
  });

  it("detects via a home config dir", () => {
    const results = detectHarnesses({
      probes: { ...NO_MATCH, homePathExists: (p) => p === "~/.deepseek" },
    });
    const deepseek = results.find((r) => r.id === "deepseek");
    expect(deepseek?.detected).toBe(true);
    expect(deepseek?.matchedSignals).toEqual([{ kind: "config-dir", detail: "~/.deepseek" }]);
  });

  it("detects via a VS Code extension dir prefix", () => {
    const results = detectHarnesses({
      probes: {
        ...NO_MATCH,
        extensionDirExists: (parent, prefix) =>
          parent === "~/.vscode/extensions" && prefix === "saoudrizwan.claude-dev",
      },
    });
    const cline = results.find((r) => r.id === "cline");
    expect(cline?.detected).toBe(true);
    expect(cline?.matchedSignals).toEqual([
      { kind: "extension-dir", detail: "~/.vscode/extensions/saoudrizwan.claude-dev*" },
    ]);
  });

  it("detects via a project marker", () => {
    const results = detectHarnesses({
      probes: { ...NO_MATCH, projectMarkerExists: (p) => p === ".windsurfrules" },
    });
    const windsurf = results.find((r) => r.id === "windsurf");
    expect(windsurf?.detected).toBe(true);
    expect(windsurf?.matchedSignals).toEqual([
      { kind: "project-marker", detail: ".windsurfrules" },
    ]);
  });

  it("records every matched signal when several match (no truncation)", () => {
    const results = detectHarnesses({
      probes: {
        binaryExists: (name) => name === "cursor" || name === "cursor-agent",
        homePathExists: (p) => p === "~/.cursor",
        extensionDirExists: () => false,
        projectMarkerExists: (p) => p === ".cursor/rules",
      },
    });
    const cursor = results.find((r) => r.id === "cursor");
    expect(cursor?.detected).toBe(true);
    expect(cursor?.matchedSignals).toEqual([
      { kind: "binary", detail: "cursor" },
      { kind: "binary", detail: "cursor-agent" },
      { kind: "config-dir", detail: "~/.cursor" },
      { kind: "project-marker", detail: ".cursor/rules" },
    ]);
  });

  it("effectiveTargetId prefers the dedicated target over the covered-by fallback", () => {
    const results = detectHarnesses({
      probes: {
        ...NO_MATCH,
        binaryExists: (name) => name === "goose" || name === "opencode",
      },
    });
    const goose = results.find((r) => r.id === "goose");
    const opencode = results.find((r) => r.id === "opencode");
    expect(goose?.connectorTargetId).toBeNull();
    expect(goose?.coveredByTargetId).toBe("codex");
    expect(goose?.effectiveTargetId).toBe("codex");
    expect(opencode?.connectorTargetId).toBe("opencode");
    expect(opencode?.coveredByTargetId).toBeNull();
    expect(opencode?.effectiveTargetId).toBe("opencode");
  });

  it("detection-only harnesses report effectiveTargetId null even when detected", () => {
    const results = detectHarnesses({
      probes: { ...NO_MATCH, binaryExists: (name) => name === "openclaw" },
    });
    const openclaw = results.find((r) => r.id === "openclaw");
    expect(openclaw?.detected).toBe(true);
    expect(openclaw?.effectiveTargetId).toBeNull();
  });

  it("the ids filter returns only the requested harnesses", () => {
    const results = detectHarnesses({ probes: NO_MATCH, ids: ["deepseek", "hermes"] });
    expect(results.map((r) => r.id)).toEqual(["deepseek", "hermes"]);
  });

  it("the ids filter throws on an id outside the catalog (typo guard)", () => {
    expect(() => detectHarnesses({ probes: NO_MATCH, ids: ["not-a-harness"] })).toThrow(
      /unknown harness id/,
    );
  });
});
