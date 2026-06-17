/**
 * S1 — `mega session saver workspace {enable,disable}` behavior tests.
 *
 * These commands write the per-workspace activation file
 * <storeRoot>/stats/<workspaceKey>/workspace-token-saver.json = {enabled, mode}
 * that the PostToolUse saver hook (saver-run.ts) reads. Distinct from the
 * session-scoped enable/disable (registry tokenSaver). Tests written BEFORE
 * implementation (CLAUDE.md §4).
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWorkspaceKey, tokenSaverModeSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runSessionSaverWorkspaceDisable,
  runSessionSaverWorkspaceEnable,
  sessionSaverCommand,
} from "../src/commands/session/saver/index.js";
import { MODE_INVALID_MESSAGE_PREFIX } from "../src/errors.js";

const WS_CWD = "/work/project-alpha";

function settingsPath(store: string, cwd: string): string {
  return join(store, "stats", encodeWorkspaceKey(cwd), "workspace-token-saver.json");
}

async function readSettings(store: string, cwd: string): Promise<unknown> {
  return JSON.parse(await readFile(settingsPath(store, cwd), "utf8"));
}

function nonJsonStderr(err: string[]): void {
  expect(err.length).toBeGreaterThan(0);
  for (const line of err) {
    expect(() => JSON.parse(line)).toThrow();
  }
}

describe("session saver workspace commands", () => {
  let store: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-saver-ws-"));
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  type RunResult = { out: string[]; err: string[]; code: number };

  async function enable(
    args: { mode?: string; cwd?: string; json?: boolean } = {},
  ): Promise<RunResult> {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runSessionSaverWorkspaceEnable({
      modeFlag: args.mode,
      storeFlag: store,
      cwd: args.cwd ?? WS_CWD,
      home: "/tmp",
      xdgDataHome: undefined,
      platform: "linux",
      localAppData: undefined,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
      json: args.json ?? false,
    });
    return { out, err, code };
  }

  async function disable(args: { cwd?: string; json?: boolean } = {}): Promise<RunResult> {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runSessionSaverWorkspaceDisable({
      storeFlag: store,
      cwd: args.cwd ?? WS_CWD,
      home: "/tmp",
      xdgDataHome: undefined,
      platform: "linux",
      localAppData: undefined,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
      json: args.json ?? false,
    });
    return { out, err, code };
  }

  // -------------------------------------------------------------------------
  // enable
  // -------------------------------------------------------------------------

  describe("enable", () => {
    it("writes {enabled:true, mode} at the resolved path with chosen mode", async () => {
      const { code } = await enable({ mode: "aggressive" });
      expect(code).toBe(0);
      const file = await readSettings(store, WS_CWD);
      expect(file).toEqual({ enabled: true, mode: "aggressive" });
    });

    it("defaults the mode when --mode omitted", async () => {
      const { code } = await enable({});
      expect(code).toBe(0);
      const file = await readSettings(store, WS_CWD);
      expect(file).toMatchObject({ enabled: true });
      // default must be a valid mode the saver hook accepts
      expect(tokenSaverModeSchema.options).toContain((file as { mode: string }).mode);
    });

    it("the written file parses under the exact saver-run.ts schema", async () => {
      await enable({ mode: "safe" });
      const file = await readSettings(store, WS_CWD);
      const schema = tokenSaverModeSchema; // mode member must be valid
      expect(schema.safeParse((file as { mode: string }).mode).success).toBe(true);
    });

    it("text mode prints workspaceKey, path, enabled, mode", async () => {
      const { out, code } = await enable({ mode: "balanced" });
      expect(code).toBe(0);
      const joined = out.join("\n");
      expect(joined).toContain(encodeWorkspaceKey(WS_CWD));
      expect(joined).toContain(settingsPath(store, WS_CWD));
      expect(joined.toLowerCase()).toContain("enabled");
      expect(joined).toContain("balanced");
    });

    it("rejects a bad --mode → exit 1, non-JSON stderr, no file written", async () => {
      const { out, err, code } = await enable({ mode: "turbo" });
      expect(code).toBe(1);
      expect(out).toHaveLength(0);
      expect(err.some((e) => e.startsWith(MODE_INVALID_MESSAGE_PREFIX))).toBe(true);
      nonJsonStderr(err);
      await expect(readFile(settingsPath(store, WS_CWD), "utf8")).rejects.toThrow();
    });

    it("is idempotent — second enable yields the same file", async () => {
      await enable({ mode: "balanced" });
      const first = await readSettings(store, WS_CWD);
      const { code } = await enable({ mode: "balanced" });
      expect(code).toBe(0);
      expect(await readSettings(store, WS_CWD)).toEqual(first);
    });

    it("json mode emits a single machine-readable line", async () => {
      const { out, code } = await enable({ mode: "safe", json: true });
      expect(code).toBe(0);
      expect(out).toHaveLength(1);
      const payload = JSON.parse(out[0] as string);
      expect(payload.enabled).toBe(true);
      expect(payload.mode).toBe("safe");
      expect(payload.workspaceKey).toBe(encodeWorkspaceKey(WS_CWD));
      expect(payload.path).toBe(settingsPath(store, WS_CWD));
    });
  });

  // -------------------------------------------------------------------------
  // disable
  // -------------------------------------------------------------------------

  describe("disable", () => {
    it("flips enabled:false preserving the existing mode", async () => {
      await enable({ mode: "safe" });
      const { code } = await disable();
      expect(code).toBe(0);
      const file = await readSettings(store, WS_CWD);
      expect(file).toEqual({ enabled: false, mode: "safe" });
    });

    it("on a fresh workspace (no prior file) → writes {enabled:false, mode:<default>}", async () => {
      const { code } = await disable();
      expect(code).toBe(0);
      const file = await readSettings(store, WS_CWD);
      expect((file as { enabled: boolean }).enabled).toBe(false);
      expect(tokenSaverModeSchema.options).toContain((file as { mode: string }).mode);
    });

    it("keeps the file (does not delete it)", async () => {
      await enable({ mode: "balanced" });
      await disable();
      await expect(readFile(settingsPath(store, WS_CWD), "utf8")).resolves.toBeTypeOf("string");
    });

    it("is idempotent — second disable yields the same file", async () => {
      await enable({ mode: "balanced" });
      await disable();
      const first = await readSettings(store, WS_CWD);
      await disable();
      expect(await readSettings(store, WS_CWD)).toEqual(first);
    });

    it("text mode prints workspaceKey, path, disabled, mode", async () => {
      await enable({ mode: "aggressive" });
      const { out, code } = await disable();
      expect(code).toBe(0);
      const joined = out.join("\n");
      expect(joined).toContain(encodeWorkspaceKey(WS_CWD));
      expect(joined).toContain(settingsPath(store, WS_CWD));
      expect(joined.toLowerCase()).toContain("disabled");
      expect(joined).toContain("aggressive");
    });
  });

  // -------------------------------------------------------------------------
  // round-trip: a hook-shaped read of the written file
  // -------------------------------------------------------------------------

  describe("round-trip with the saver hook schema", () => {
    it("enable then read back yields enabled:true under the {enabled, mode} shape", async () => {
      await enable({ mode: "balanced" });
      const file = (await readSettings(store, WS_CWD)) as { enabled: boolean; mode: string };
      expect(file.enabled).toBe(true);
      expect(tokenSaverModeSchema.options).toContain(file.mode);
    });
  });
});

// ---------------------------------------------------------------------------
// Subcommand wiring
// ---------------------------------------------------------------------------

describe("sessionSaverCommand workspace wiring", () => {
  it("exposes a workspace subcommand with enable + disable", () => {
    const sub = sessionSaverCommand.subCommands as Record<string, unknown>;
    expect(Object.keys(sub)).toContain("workspace");
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const ws = (sub["workspace"] as { subCommands?: Record<string, unknown> }).subCommands ?? {};
    expect(Object.keys(ws).sort()).toEqual(["disable", "enable"]);
  });
});
