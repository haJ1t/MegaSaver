import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handoffCommand } from "../../src/commands/handoff/index.js";
import { mainCommand } from "../../src/main.js";

describe("handoff registration", () => {
  it("main registers handoff as a subcommand", () => {
    const subs = mainCommand.subCommands as Record<string, unknown>;
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(subs["handoff"]).toBe(handoffCommand);
  });

  it("handoff is subcommands-only: pack/open/inspect/clear, no root run/args", () => {
    const subs = handoffCommand.subCommands as Record<string, unknown>;
    expect(Object.keys(subs).sort()).toEqual(["clear", "inspect", "open", "pack"]);
    expect(handoffCommand.run).toBeUndefined();
    expect(handoffCommand.args).toBeUndefined();
  });
});

function writeValidPacket(dir: string): string {
  const payload = {
    taskSummary: { text: "Task: ship hot handoff", tokenEstimate: 12 },
    resumeInstructions: "Resume the handoff task.",
    git: null,
    failures: [],
    memories: [],
  };
  const payloadJson = JSON.stringify(payload);
  const manifest = {
    schemaVersion: "1",
    kind: "megahandoff",
    sourceProject: { name: "alpha" },
    sourceAgent: "claude-code",
    targetAgent: "codex",
    createdAt: "2026-07-15T11:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    payloadSha256: createHash("sha256").update(payloadJson).digest("hex"),
    redactionFindings: 0,
    secretPathsExcluded: 0,
    counts: { memories: 0, failures: 0, diffFiles: 0, commits: 0 },
  };
  const file = join(dir, "packet.megahandoff");
  writeFileSync(file, `${JSON.stringify(manifest)}\n${payloadJson}`);
  return file;
}

// Drive the REAL citty tree end to end: these fail under the old root-run+args
// structure (`Unknown command codex` / `Missing required argument: --to`), which
// is exactly the dispatch break an identity check could not catch.
describe("handoff dispatch through the real command tree", () => {
  let store: string;
  let files: string;
  let out: string[];
  let err: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    store = mkdtempSync(join(tmpdir(), "megasaver-handoff-dispatch-store-"));
    files = mkdtempSync(join(tmpdir(), "megasaver-handoff-dispatch-files-"));
    out = [];
    err = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      out.push(a.join(" "));
    });
    errSpy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      err.push(a.join(" "));
    });
    process.exitCode = undefined;
  });
  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = undefined;
    rmSync(store, { recursive: true, force: true });
    rmSync(files, { recursive: true, force: true });
  });

  it("`handoff pack --to codex` routes to pack, not `Unknown command codex`", async () => {
    await runCommand(mainCommand, {
      rawArgs: ["handoff", "pack", "--to", "codex", "--store", store],
    });
    // Unlicensed store → the pack handler runs and prints the upsell: proof the
    // subcommand dispatched and consumed --to (old structure never reached here).
    expect(out.join("\n")).toContain("Hot handoff is a Mega Saver Pro feature");
    expect(err.join("\n")).not.toContain("Unknown command");
  });

  it("`handoff open <file>` routes to open, not `Missing required argument: --to`", async () => {
    await runCommand(mainCommand, {
      rawArgs: ["handoff", "open", join(files, "any.megahandoff"), "--store", store],
    });
    expect(out.join("\n")).toContain("Hot handoff is a Mega Saver Pro feature");
    expect(err.join("\n")).not.toContain("Missing required argument");
  });

  it("`handoff inspect <file>` (free) fully executes through dispatch", async () => {
    const packet = writeValidPacket(files);
    await runCommand(mainCommand, {
      rawArgs: ["handoff", "inspect", packet, "--store", store],
    });
    expect(out.join("\n")).toMatch(/^manifest: /m);
    expect(err.join("\n")).not.toContain("Unknown command");
  });
});
