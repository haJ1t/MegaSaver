/**
 * BB2 — `mega session saver {enable,disable,status,stats}` behavior tests.
 *
 * Mirrors the temp-store idiom of connector-status.test.ts and the
 * run-fn invocation idiom of json-failure-paths.test.ts: seed
 * projects.json + sessions.json under a mkdtemp store, call the
 * exported run-fn with explicit stdout/stderr sinks, assert exit code
 * + emitted lines. Tests written BEFORE implementation (CLAUDE.md §4).
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvent } from "@megasaver/core";
import { type ProjectId, type SessionId, modeToBudget } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runSessionSaverDisable,
  runSessionSaverEnable,
  runSessionSaverStats,
  runSessionSaverStatus,
  sessionSaverCommand,
} from "../src/commands/session/saver/index.js";
import {
  MODE_INVALID_MESSAGE_PREFIX,
  invalidModeMessage,
  missingModeMessage,
  unexpectedModeMessage,
} from "../src/errors.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const MISSING_SESSION_ID = "99999999-9999-4999-8999-999999999999";
const SEED_TS = "2026-05-09T00:00:00.000Z";
const NOW_TS = "2026-05-10T12:00:00.000Z";

function nowFn(): string {
  return NOW_TS;
}

function nonJsonStderr(err: string[]): void {
  expect(err.length).toBeGreaterThan(0);
  for (const line of err) {
    expect(() => JSON.parse(line)).toThrow();
  }
}

// ---------------------------------------------------------------------------
// Error helpers (Step 1 — pure unit assertions, no store needed)
// ---------------------------------------------------------------------------

describe("session saver error helpers", () => {
  it("invalidModeMessage lists the three modes and exits 1", () => {
    const cli = invalidModeMessage("bogus");
    expect(cli.message.startsWith(MODE_INVALID_MESSAGE_PREFIX)).toBe(true);
    expect(cli.message).toContain('"bogus"');
    expect(cli.message).toContain("aggressive | balanced | safe");
    expect(cli.exitCode).toBe(1);
  });

  it("missingModeMessage exits 1", () => {
    const cli = missingModeMessage();
    expect(cli.message).toContain("--mode");
    expect(cli.exitCode).toBe(1);
  });

  it("unexpectedModeMessage exits 1", () => {
    const cli = unexpectedModeMessage();
    expect(cli.message).toContain("--mode");
    expect(cli.exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Shared temp-store harness
// ---------------------------------------------------------------------------

describe("session saver commands", () => {
  let store: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-saver-"));
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  async function seed(opts: { withSession?: boolean } = {}): Promise<void> {
    await mkdir(store, { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        {
          id: PROJECT_ID,
          name: "demo",
          rootPath: "/tmp",
          createdAt: SEED_TS,
          updatedAt: SEED_TS,
        },
      ]),
    );
    const sessions =
      opts.withSession === false
        ? []
        : [
            {
              id: SESSION_ID,
              projectId: PROJECT_ID,
              agentId: "claude-code",
              riskLevel: "medium",
              title: null,
              startedAt: SEED_TS,
              endedAt: null,
            },
          ];
    await writeFile(join(store, "sessions.json"), JSON.stringify(sessions));
  }

  async function readSession(id: string): Promise<Record<string, unknown> | undefined> {
    const arr = JSON.parse(await readFile(join(store, "sessions.json"), "utf8"));
    return arr.find((s: { id: string }) => s.id === id);
  }

  type RunResult = { out: string[]; err: string[]; code: number };

  async function enable(args: { mode?: string; sessionId?: string }): Promise<RunResult> {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runSessionSaverEnable({
      sessionId: args.sessionId ?? SESSION_ID,
      modeFlag: args.mode,
      storeFlag: store,
      cwd: "/tmp",
      home: "/tmp",
      xdgDataHome: undefined,
      platform: "linux",
      localAppData: undefined,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
      json: false,
      now: nowFn,
    });
    return { out, err, code };
  }

  async function enableJson(args: { mode: string }): Promise<RunResult> {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runSessionSaverEnable({
      sessionId: SESSION_ID,
      modeFlag: args.mode,
      storeFlag: store,
      cwd: "/tmp",
      home: "/tmp",
      xdgDataHome: undefined,
      platform: "linux",
      localAppData: undefined,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
      json: true,
      now: nowFn,
    });
    return { out, err, code };
  }

  async function disable(
    args: {
      sessionId?: string;
      mode?: string;
      json?: boolean;
    } = {},
  ): Promise<RunResult> {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runSessionSaverDisable({
      sessionId: args.sessionId ?? SESSION_ID,
      modeFlag: args.mode,
      storeFlag: store,
      cwd: "/tmp",
      home: "/tmp",
      xdgDataHome: undefined,
      platform: "linux",
      localAppData: undefined,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
      json: args.json ?? false,
      now: nowFn,
    });
    return { out, err, code };
  }

  async function status(
    args: {
      sessionId?: string;
      mode?: string;
      json?: boolean;
    } = {},
  ): Promise<RunResult> {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runSessionSaverStatus({
      sessionId: args.sessionId ?? SESSION_ID,
      modeFlag: args.mode,
      storeFlag: store,
      cwd: "/tmp",
      home: "/tmp",
      xdgDataHome: undefined,
      platform: "linux",
      localAppData: undefined,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
      json: args.json ?? false,
      now: nowFn,
    });
    return { out, err, code };
  }

  async function stats(
    args: {
      sessionId?: string;
      mode?: string;
      json?: boolean;
    } = {},
  ): Promise<RunResult> {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runSessionSaverStats({
      sessionId: args.sessionId ?? SESSION_ID,
      modeFlag: args.mode,
      storeFlag: store,
      cwd: "/tmp",
      home: "/tmp",
      xdgDataHome: undefined,
      platform: "linux",
      localAppData: undefined,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
      json: args.json ?? false,
      now: nowFn,
    });
    return { out, err, code };
  }

  // -------------------------------------------------------------------------
  // enable
  // -------------------------------------------------------------------------

  describe("enable", () => {
    it("balanced → exit 0, persists enabled settings with budget 12000 (JSON)", async () => {
      await seed();
      const { out, code } = await enableJson({ mode: "balanced" });
      expect(code).toBe(0);
      expect(out).toHaveLength(1);
      const payload = JSON.parse(out[0] as string);
      expect(payload.sessionId).toBe(SESSION_ID);
      expect(payload.tokenSaver.enabled).toBe(true);
      expect(payload.tokenSaver.mode).toBe("balanced");
      expect(payload.tokenSaver.maxReturnedBytes).toBe(modeToBudget("balanced"));
      expect(payload.tokenSaver.maxReturnedBytes).toBe(12000);
      // defaults threaded from defaultTokenSaverSettings
      expect(payload.tokenSaver.storeRawOutput).toBe(true);
      expect(payload.tokenSaver.redactSecrets).toBe(true);
      expect(payload.tokenSaver.autoRepair).toBe(true);
      expect(payload.tokenSaver.createdAt).toBe(NOW_TS);
      expect(payload.tokenSaver.updatedAt).toBe(NOW_TS);
    });

    it("persists settings to the store (read-back via sessions.json)", async () => {
      await seed();
      await enable({ mode: "aggressive" });
      const session = await readSession(SESSION_ID);
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      expect(session?.["tokenSaver"]).toMatchObject({
        enabled: true,
        mode: "aggressive",
        maxReturnedBytes: modeToBudget("aggressive"),
      });
    });

    it("safe budget maps to 32000", async () => {
      await seed();
      const { out } = await enableJson({ mode: "safe" });
      const payload = JSON.parse(out[0] as string);
      expect(payload.tokenSaver.maxReturnedBytes).toBe(32000);
    });

    it("text mode emits one summary line with mode + budget", async () => {
      await seed();
      const { out, code } = await enable({ mode: "balanced" });
      expect(code).toBe(0);
      expect(out).toHaveLength(1);
      expect(out[0]).toContain(SESSION_ID);
      expect(out[0]).toContain("balanced");
      expect(out[0]).toContain("12000");
    });

    it("preserves createdAt when settings already exist, bumps updatedAt", async () => {
      await seed();
      await enable({ mode: "safe" }); // createdAt = NOW_TS
      // Re-enable with a different now to confirm createdAt is preserved.
      const out: string[] = [];
      const later = "2026-05-11T08:00:00.000Z";
      await runSessionSaverEnable({
        sessionId: SESSION_ID,
        modeFlag: "aggressive",
        storeFlag: store,
        cwd: "/tmp",
        home: "/tmp",
        xdgDataHome: undefined,
        platform: "linux",
        localAppData: undefined,
        stdout: (line) => out.push(line),
        stderr: () => {},
        json: true,
        now: () => later,
      });
      const payload = JSON.parse(out[0] as string);
      expect(payload.tokenSaver.createdAt).toBe(NOW_TS);
      expect(payload.tokenSaver.updatedAt).toBe(later);
    });

    it("missing --mode → exit 1, non-JSON stderr, no stdout", async () => {
      await seed();
      const { out, err, code } = await enable({});
      expect(code).toBe(1);
      expect(out).toHaveLength(0);
      expect(err).toContain(missingModeMessage().message);
      nonJsonStderr(err);
    });

    it("invalid --mode → exit 1, non-JSON stderr, no stdout", async () => {
      await seed();
      const { out, err, code } = await enable({ mode: "turbo" });
      expect(code).toBe(1);
      expect(out).toHaveLength(0);
      expect(err.some((e) => e.startsWith(MODE_INVALID_MESSAGE_PREFIX))).toBe(true);
      nonJsonStderr(err);
    });

    it("not-found session → exit 1, non-JSON stderr", async () => {
      await seed({ withSession: false });
      const { out, err, code } = await enable({ mode: "balanced", sessionId: MISSING_SESSION_ID });
      expect(code).toBe(1);
      expect(out).toHaveLength(0);
      expect(err.some((e) => /not found/.test(e))).toBe(true);
      nonJsonStderr(err);
    });

    it("respects --store override (writes into the given store dir)", async () => {
      await seed();
      const { code } = await enable({ mode: "balanced" });
      expect(code).toBe(0);
      const session = await readSession(SESSION_ID);
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      expect(session?.["tokenSaver"]).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // disable
  // -------------------------------------------------------------------------

  describe("disable", () => {
    it("after enable → enabled:false, createdAt preserved, updatedAt bumped", async () => {
      await seed();
      await enable({ mode: "safe" }); // createdAt/updatedAt = NOW_TS
      const out: string[] = [];
      const later = "2026-05-12T09:00:00.000Z";
      const code = await runSessionSaverDisable({
        sessionId: SESSION_ID,
        modeFlag: undefined,
        storeFlag: store,
        cwd: "/tmp",
        home: "/tmp",
        xdgDataHome: undefined,
        platform: "linux",
        localAppData: undefined,
        stdout: (line) => out.push(line),
        stderr: () => {},
        json: true,
        now: () => later,
      });
      expect(code).toBe(0);
      const payload = JSON.parse(out[0] as string);
      expect(payload.tokenSaver.enabled).toBe(false);
      expect(payload.tokenSaver.mode).toBe("safe");
      expect(payload.tokenSaver.createdAt).toBe(NOW_TS);
      expect(payload.tokenSaver.updatedAt).toBe(later);
    });

    it("on a pre-AA session (no prior settings) → writes defaults with enabled:false", async () => {
      await seed();
      const { out, code } = await disable({ json: true });
      expect(code).toBe(0);
      const payload = JSON.parse(out[0] as string);
      expect(payload.tokenSaver.enabled).toBe(false);
      expect(payload.tokenSaver.createdAt).toBe(NOW_TS);
      expect(payload.tokenSaver.updatedAt).toBe(NOW_TS);
    });

    it("text mode emits one disabled summary line", async () => {
      await seed();
      const { out, code } = await disable();
      expect(code).toBe(0);
      expect(out).toHaveLength(1);
      expect(out[0]).toContain(SESSION_ID);
      expect(out[0]?.toLowerCase()).toContain("disabled");
    });

    it("rejects --mode → exit 1, non-JSON stderr, no stdout", async () => {
      await seed();
      const { out, err, code } = await disable({ mode: "safe" });
      expect(code).toBe(1);
      expect(out).toHaveLength(0);
      expect(err).toContain(unexpectedModeMessage().message);
      nonJsonStderr(err);
    });

    it("not-found session → exit 1, non-JSON stderr", async () => {
      await seed({ withSession: false });
      const { out, err, code } = await disable({ sessionId: MISSING_SESSION_ID });
      expect(code).toBe(1);
      expect(out).toHaveLength(0);
      nonJsonStderr(err);
    });
  });

  // -------------------------------------------------------------------------
  // status
  // -------------------------------------------------------------------------

  describe("status", () => {
    it("configured session → reports enabled/mode/budget line", async () => {
      await seed();
      await enable({ mode: "balanced" });
      const { out, code } = await status();
      expect(code).toBe(0);
      expect(out).toHaveLength(1);
      expect(out[0]).toContain(SESSION_ID);
      expect(out[0]).toContain("balanced");
      expect(out[0]).toContain("12000");
    });

    it("configured session JSON → { sessionId, tokenSaver }", async () => {
      await seed();
      await enable({ mode: "safe" });
      const { out, code } = await status({ json: true });
      expect(code).toBe(0);
      const payload = JSON.parse(out[0] as string);
      expect(payload.sessionId).toBe(SESSION_ID);
      expect(payload.tokenSaver.mode).toBe("safe");
      expect(payload.tokenSaver.enabled).toBe(true);
    });

    it("pre-AA session (tokenSaver undefined) → not-configured CTA text", async () => {
      await seed();
      const { out, code } = await status();
      expect(code).toBe(0);
      expect(out).toHaveLength(1);
      expect(out[0]).toContain("not configured");
      expect(out[0]).toContain(SESSION_ID);
      expect(out[0]).toContain("--mode");
    });

    it("pre-AA session JSON → tokenSaver null", async () => {
      await seed();
      const { out, code } = await status({ json: true });
      expect(code).toBe(0);
      const payload = JSON.parse(out[0] as string);
      expect(payload.sessionId).toBe(SESSION_ID);
      expect(payload.tokenSaver).toBeNull();
    });

    it("does not mutate the session (read-only)", async () => {
      await seed();
      const before = await readSession(SESSION_ID);
      await status();
      const after = await readSession(SESSION_ID);
      expect(after).toEqual(before);
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      expect(after?.["tokenSaver"]).toBeUndefined();
    });

    it("rejects --mode → exit 1, non-JSON stderr, no stdout", async () => {
      await seed();
      const { out, err, code } = await status({ mode: "safe" });
      expect(code).toBe(1);
      expect(out).toHaveLength(0);
      expect(err).toContain(unexpectedModeMessage().message);
      nonJsonStderr(err);
    });

    it("not-found session → exit 1, non-JSON stderr", async () => {
      await seed({ withSession: false });
      const { out, err, code } = await status({ sessionId: MISSING_SESSION_ID });
      expect(code).toBe(1);
      expect(out).toHaveLength(0);
      nonJsonStderr(err);
    });
  });

  // -------------------------------------------------------------------------
  // stats
  // -------------------------------------------------------------------------

  describe("stats", () => {
    it("configured session JSON → { sessionId, tokenSaver, eventStats: null }", async () => {
      await seed();
      await enable({ mode: "balanced" });
      const { out, code } = await stats({ json: true });
      expect(code).toBe(0);
      const payload = JSON.parse(out[0] as string);
      expect(payload.sessionId).toBe(SESSION_ID);
      expect(payload.tokenSaver.mode).toBe("balanced");
      expect(payload.eventStats).toBeNull();
    });

    it("configured session, no events → settings line + 'No events recorded yet.'", async () => {
      await seed();
      await enable({ mode: "balanced" });
      const { out, code } = await stats();
      expect(code).toBe(0);
      const joined = out.join("\n");
      expect(joined).toContain("balanced");
      expect(joined).toContain("12000");
      expect(joined).toContain("No events recorded yet.");
      expect(joined).not.toContain("arrive with BB6");
    });

    function recordEvent(): void {
      appendEvent({
        store: { root: store },
        event: {
          id: "evt-1",
          sessionId: SESSION_ID as SessionId,
          projectId: PROJECT_ID as ProjectId,
          createdAt: NOW_TS,
          sourceKind: "file",
          label: "/tmp/log.txt",
          rawBytes: 1000,
          returnedBytes: 200,
          bytesSaved: 800,
          savingRatio: 0.8,
          summary: "demo",
          mode: "balanced",
        },
        secretsRedacted: 1,
        chunksStored: 3,
      });
    }

    it("with recorded events → text totals from the summary", async () => {
      await seed();
      await enable({ mode: "balanced" });
      recordEvent();
      const { out, code } = await stats();
      expect(code).toBe(0);
      const joined = out.join("\n");
      expect(joined).toContain("events: 1");
      expect(joined).toContain("raw: 1000 B");
      expect(joined).toContain("returned: 200 B");
      expect(joined).toContain("saved: 800 B (80.0%)");
      expect(joined).toContain("secrets redacted: 1");
      expect(joined).toContain("chunks stored: 3");
    });

    it("corrupt summary file → error: store_corrupt, exit 1, no stdout", async () => {
      await seed();
      await enable({ mode: "balanced" });
      await mkdir(join(store, "stats", PROJECT_ID), { recursive: true });
      await writeFile(join(store, "stats", PROJECT_ID, `${SESSION_ID}.json`), "{not json");
      const { out, err, code } = await stats({ json: true });
      expect(code).toBe(1);
      expect(out).toHaveLength(0);
      expect(err.join("\n")).toContain("error: store_corrupt:");
    });

    it("with recorded events → --json carries the full summary", async () => {
      await seed();
      await enable({ mode: "balanced" });
      recordEvent();
      const { out, code } = await stats({ json: true });
      expect(code).toBe(0);
      const payload = JSON.parse(out[0] as string);
      expect(payload.eventStats).toMatchObject({
        sessionId: SESSION_ID,
        eventsTotal: 1,
        rawBytesTotal: 1000,
        returnedBytesTotal: 200,
        bytesSavedTotal: 800,
        savingRatio: 0.8,
        secretsRedactedTotal: 1,
        chunksStoredTotal: 3,
      });
    });

    it("pre-AA session → not-configured CTA, no invented counters", async () => {
      await seed();
      const { out, code } = await stats();
      expect(code).toBe(0);
      expect(out.join("\n")).toContain("not configured");
    });

    it("pre-AA session JSON → tokenSaver null, eventStats null", async () => {
      await seed();
      const { out, code } = await stats({ json: true });
      expect(code).toBe(0);
      const payload = JSON.parse(out[0] as string);
      expect(payload.tokenSaver).toBeNull();
      expect(payload.eventStats).toBeNull();
    });

    it("does not mutate the session (read-only)", async () => {
      await seed();
      await enable({ mode: "safe" });
      const before = await readSession(SESSION_ID);
      await stats();
      const after = await readSession(SESSION_ID);
      expect(after).toEqual(before);
    });

    it("rejects --mode → exit 1, non-JSON stderr, no stdout", async () => {
      await seed();
      const { out, err, code } = await stats({ mode: "safe" });
      expect(code).toBe(1);
      expect(out).toHaveLength(0);
      expect(err).toContain(unexpectedModeMessage().message);
      nonJsonStderr(err);
    });

    it("not-found session → exit 1, non-JSON stderr", async () => {
      await seed({ withSession: false });
      const { out, err, code } = await stats({ sessionId: MISSING_SESSION_ID });
      expect(code).toBe(1);
      expect(out).toHaveLength(0);
      nonJsonStderr(err);
    });
  });
});

// ---------------------------------------------------------------------------
// Subcommand wiring (Step 4)
// ---------------------------------------------------------------------------

describe("sessionSaverCommand wiring", () => {
  it("exposes the four subcommands", () => {
    const sub = sessionSaverCommand.subCommands as Record<string, unknown>;
    expect(Object.keys(sub).sort()).toEqual(["disable", "enable", "stats", "status"]);
  });
});

// ---------------------------------------------------------------------------
// CLI-level --mode rejection (binary surface, not run-fn)
//
// The run-fn tests above bypass Citty arg parsing. These drive the actual
// command objects so a regression where a subcommand drops its `mode` arg
// (silently absorbing `--mode` as an unknown non-strict flag) is caught.
// ---------------------------------------------------------------------------

describe("session saver CLI-level --mode rejection", () => {
  let store: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-saver-cli-"));
    await mkdir(store, { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: SEED_TS, updatedAt: SEED_TS },
      ]),
    );
    await writeFile(
      join(store, "sessions.json"),
      JSON.stringify([
        {
          id: SESSION_ID,
          projectId: PROJECT_ID,
          agentId: "claude-code",
          riskLevel: "medium",
          title: null,
          startedAt: SEED_TS,
          endedAt: null,
        },
      ]),
    );
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    await rm(store, { recursive: true, force: true });
  });

  for (const name of ["disable", "status", "stats"] as const) {
    it(`${name} --mode reaches the rejection via the command object (exit 1)`, async () => {
      const sub = sessionSaverCommand.subCommands as Record<
        string,
        { run?: (ctx: unknown) => unknown | Promise<unknown> }
      >;
      const cmd = sub[name];
      if (cmd === undefined) throw new Error(`missing subcommand ${name}`);
      await cmd.run?.({
        args: { sessionId: SESSION_ID, mode: "safe", store },
        cmd,
        rawArgs: [],
        data: undefined,
      } as never);

      expect(process.exitCode).toBe(1);
      expect(logSpy).not.toHaveBeenCalled();
      const stderr = errSpy.mock.calls.map((c) => String(c[0]));
      expect(stderr.some((line) => line.includes("--mode"))).toBe(true);
    });
  }
});
