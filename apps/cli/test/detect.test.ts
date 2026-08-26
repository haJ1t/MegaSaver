import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DetectionProbes } from "@megasaver/harness-detect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type RunHarnessAutoConfigureInput,
  detectCommand,
  filterSyncLine,
  runDetect,
  runHarnessAutoConfigure,
} from "../src/commands/detect.js";
import { mainCommand } from "../src/main.js";

const NO_MATCH_PROBES: DetectionProbes = {
  binaryExists: () => false,
  homePathExists: () => false,
  extensionDirExists: () => false,
  projectMarkerExists: () => false,
};

function claudeOnlyProbes() {
  return {
    ...NO_MATCH_PROBES,
    binaryExists: (name: string) => name === "claude",
  };
}

describe("runDetect — text mode", () => {
  it("prints one line per catalog harness plus the summary, exit 0", async () => {
    const lines: string[] = [];
    const code = await runDetect({
      home: "/home/test",
      cwd: "/cwd",
      platform: "darwin",
      envPath: "/usr/bin",
      json: false,
      probes: claudeOnlyProbes(),
      stdout: (l) => lines.push(l),
      stderr: () => {},
    });
    expect(code).toBe(0);
    // 39 catalog lines + 1 summary line.
    expect(lines).toHaveLength(40);
    const claudeLine = lines.find((l) => l.startsWith("claude-code "));
    expect(claudeLine).toContain("detected");
    expect(claudeLine).toContain("signals=binary:claude");
    expect(claudeLine).toContain("target=claude-code");
    const deepseekLine = lines.find((l) => l.startsWith("deepseek "));
    expect(deepseekLine).toContain("absent");
    expect(deepseekLine).toContain("target=-");
    expect(lines.at(-1)).toBe("detected 1 of 39 known harnesses");
  });

  it("reports multiple matched signals separated by ;", async () => {
    const lines: string[] = [];
    await runDetect({
      home: "/home/test",
      cwd: "/cwd",
      platform: "darwin",
      envPath: "/usr/bin",
      json: false,
      probes: {
        ...NO_MATCH_PROBES,
        binaryExists: (name) => name === "cursor",
        homePathExists: (p) => p === "~/.cursor",
      },
      stdout: (l) => lines.push(l),
      stderr: () => {},
    });
    const cursorLine = lines.find((l) => l.startsWith("cursor "));
    expect(cursorLine).toContain("signals=binary:cursor;config-dir:~/.cursor");
  });

  it("folds the AGENTS.md family onto the codex target (goose)", async () => {
    const lines: string[] = [];
    await runDetect({
      home: "/home/test",
      cwd: "/cwd",
      platform: "darwin",
      envPath: "/usr/bin",
      json: false,
      probes: { ...NO_MATCH_PROBES, binaryExists: (name) => name === "goose" },
      stdout: (l) => lines.push(l),
      stderr: () => {},
    });
    const gooseLine = lines.find((l) => l.startsWith("goose "));
    expect(gooseLine).toContain("target=codex");
  });
});

describe("runDetect — --json mode", () => {
  it("emits a single JSON array of 39 records with the honest shape", async () => {
    const lines: string[] = [];
    const code = await runDetect({
      home: "/home/test",
      cwd: "/cwd",
      platform: "darwin",
      envPath: "/usr/bin",
      json: true,
      probes: claudeOnlyProbes(),
      stdout: (l) => lines.push(l),
      stderr: () => {},
    });
    expect(code).toBe(0);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? "[]") as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(39);
    // biome-ignore lint/complexity/useLiteralKeys: tsconfig noPropertyAccessFromIndexSignature requires brackets
    const claude = parsed.find((r) => r["id"] === "claude-code");
    expect(claude).toEqual({
      id: "claude-code",
      name: "Claude Code",
      category: "cli",
      detected: true,
      signals: [{ kind: "binary", detail: "claude" }],
      target: "claude-code",
    });
    // biome-ignore lint/complexity/useLiteralKeys: tsconfig noPropertyAccessFromIndexSignature requires brackets
    const deepseek = parsed.find((r) => r["id"] === "deepseek");
    expect(deepseek).toEqual({
      id: "deepseek",
      name: "DeepSeek CLI",
      category: "cli",
      detected: false,
      signals: [],
      target: null,
    });
  });
});

describe("detectCommand — citty registration", () => {
  it("is registered as a top-level `mega` subcommand", () => {
    const subs = (mainCommand as unknown as { subCommands?: Record<string, unknown> }).subCommands;
    // biome-ignore lint/complexity/useLiteralKeys: tsconfig noPropertyAccessFromIndexSignature requires brackets
    expect(subs?.["detect"]).toBe(detectCommand);
  });

  it("declares the standard --json flag shape", () => {
    const args = (
      detectCommand as unknown as {
        args?: Record<string, { type: string; default: boolean; description: string }>;
      }
    ).args;
    // biome-ignore lint/complexity/useLiteralKeys: tsconfig noPropertyAccessFromIndexSignature requires brackets
    expect(args?.["json"]).toEqual({
      type: "boolean",
      default: false,
      description: "Emit JSON output.",
    });
  });
});

describe("runHarnessAutoConfigure — init step engine", () => {
  type HarnessScanHarness = {
    lines: string[];
    errLines: string[];
    syncTarget: ReturnType<typeof vi.fn>;
    resolveProject: ReturnType<typeof vi.fn>;
  };

  function scanHarness(
    probes: DetectionProbes,
    project: { name: string } | null,
  ): HarnessScanHarness {
    const lines: string[] = [];
    const errLines: string[] = [];
    const syncTarget = vi.fn(async () => 0 as const);
    const resolveProject = vi.fn(async () => project);
    return { lines, errLines, syncTarget, resolveProject };
  }

  function run(
    h: HarnessScanHarness,
    probes: DetectionProbes,
    resolveProject?: RunHarnessAutoConfigureInput["resolveProject"],
    syncTarget?: RunHarnessAutoConfigureInput["syncTarget"],
  ) {
    return runHarnessAutoConfigure({
      home: "/home/test",
      cwd: "/cwd",
      platform: "darwin",
      envPath: "/usr/bin",
      probes,
      resolveProject: resolveProject ?? h.resolveProject,
      syncTarget: syncTarget ?? h.syncTarget,
      stdout: (l) => h.lines.push(l),
      stderr: (l) => h.errLines.push(l),
    });
  }

  it("zero detected → honest no-detection line, no store touch, exit 0", async () => {
    const h = scanHarness(NO_MATCH_PROBES, { name: "demo" });
    const code = await run(h, NO_MATCH_PROBES);
    expect(code).toBe(0);
    expect(h.lines).toEqual(["no harnesses detected — nothing to auto-configure."]);
    expect(h.resolveProject).not.toHaveBeenCalled();
    expect(h.syncTarget).not.toHaveBeenCalled();
  });

  it("detected with targets + resolvable project → syncs each unique target once", async () => {
    // claude-code (own target), goose (folds to codex), cursor (own target).
    const probes: DetectionProbes = {
      ...NO_MATCH_PROBES,
      binaryExists: (name) => name === "claude" || name === "goose" || name === "cursor",
    };
    const h = scanHarness(probes, { name: "demo" });
    const code = await run(h, probes);
    expect(code).toBe(0);
    expect(h.lines[0]).toBe("harnesses detected: 3");
    expect(h.lines).toContain("  claude-code  Claude Code  target=claude-code");
    expect(h.lines).toContain("  goose  Goose (Block)  target=codex");
    expect(h.lines).toContain("  cursor  Cursor  target=cursor");
    expect(h.syncTarget).toHaveBeenCalledTimes(3);
    expect(h.syncTarget).toHaveBeenCalledWith("demo", "claude-code");
    expect(h.syncTarget).toHaveBeenCalledWith("demo", "codex");
    expect(h.syncTarget).toHaveBeenCalledWith("demo", "cursor");
  });

  it("dedupes harnesses sharing one target (codex + goose → one codex sync)", async () => {
    const probes: DetectionProbes = {
      ...NO_MATCH_PROBES,
      binaryExists: (name) => name === "codex" || name === "goose",
    };
    const h = scanHarness(probes, { name: "demo" });
    const code = await run(h, probes);
    expect(code).toBe(0);
    expect(h.syncTarget).toHaveBeenCalledTimes(1);
    expect(h.syncTarget).toHaveBeenCalledWith("demo", "codex");
  });

  it("detected but no project for cwd → honest skip lines, exit 0, no sync", async () => {
    const probes: DetectionProbes = {
      ...NO_MATCH_PROBES,
      binaryExists: (name) => name === "claude",
    };
    const h = scanHarness(probes, null);
    const code = await run(h, probes);
    expect(code).toBe(0);
    expect(h.syncTarget).not.toHaveBeenCalled();
    const out = h.lines.join("\n");
    expect(out).toContain("no project registered for /cwd");
    expect(out).toContain("mega project create");
  });

  it("detection-only harnesses detected → maps-to-target line, no sync, exit 0", async () => {
    const probes: DetectionProbes = {
      ...NO_MATCH_PROBES,
      binaryExists: (name) => name === "deepseek" || name === "hermes",
    };
    const h = scanHarness(probes, { name: "demo" });
    const code = await run(h, probes);
    expect(code).toBe(0);
    expect(h.syncTarget).not.toHaveBeenCalled();
    expect(h.lines.join("\n")).toContain(
      "no detected harness maps to a Mega Saver connector target",
    );
  });

  it("a failing sync marks the step failed (exit 1)", async () => {
    const probes: DetectionProbes = {
      ...NO_MATCH_PROBES,
      binaryExists: (name) => name === "claude",
    };
    const h = scanHarness(probes, { name: "demo" });
    const failingSync = vi.fn(async () => 1 as const);
    const code = await run(h, probes, undefined, failingSync);
    expect(code).toBe(1);
    expect(failingSync).toHaveBeenCalledTimes(1);
  });

  it("a throwing resolveProject surfaces the error and fails the step", async () => {
    const probes: DetectionProbes = {
      ...NO_MATCH_PROBES,
      binaryExists: (name) => name === "claude",
    };
    const h = scanHarness(probes, null);
    const throwingResolve = vi.fn(async () => {
      throw new Error("EACCES: store unreadable");
    });
    const code = await run(h, probes, throwingResolve);
    expect(code).toBe(1);
    expect(h.errLines.join("\n")).toContain("EACCES");
  });
});

describe("filterSyncLine — init harness-step stdout filter", () => {
  it("drops per-target `skipped` noise lines (15 of 16 per seeded sync)", () => {
    expect(filterSyncLine("cursor       .cursor/rules/megasaver.mdc  skipped  session=none")).toBe(
      false,
    );
    expect(filterSyncLine("qwen         QWEN.md  skipped  session=none")).toBe(false);
  });

  it("keeps the meaningful statuses: created / wrote / noop / error", () => {
    expect(filterSyncLine("claude-code  CLAUDE.md  created  session=none")).toBe(true);
    expect(filterSyncLine("codex        AGENTS.md  wrote  session=abc")).toBe(true);
    expect(filterSyncLine("claude-code  CLAUDE.md  noop  session=abc")).toBe(true);
    expect(filterSyncLine("codex        AGENTS.md  error  session=none")).toBe(true);
  });

  it("keeps every non-status line (sync banners, hints, anything else)", () => {
    expect(filterSyncLine("note: initialized store at /tmp/x")).toBe(true);
    expect(filterSyncLine("")).toBe(true);
  });
});

describe("runDetect — real probes wiring", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "megasaver-detect-cli-home-"));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("uses createNodeProbes against the injected home when no probes are supplied", async () => {
    const lines: string[] = [];
    const code = await runDetect({
      home,
      cwd: "/cwd",
      platform: "darwin",
      envPath: "/usr/bin",
      json: false,
      probes: undefined,
      stdout: (l) => lines.push(l),
      stderr: () => {},
    });
    expect(code).toBe(0);
    // Nothing seeded under the temp home → honest zero-detection summary.
    expect(lines.at(-1)).toMatch(/^detected 0 of 39 known harnesses$/);
  });
});
