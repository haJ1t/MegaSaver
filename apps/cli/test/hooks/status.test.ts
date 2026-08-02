import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordInvocationHeartbeat } from "@megasaver/context-gate";
import { type TokenSaverEvent, appendEvent } from "@megasaver/core";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hooksStatusCommand, runHooksStatus } from "../../src/commands/hooks/status.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const SESSION_ID = "22222222-2222-4222-8222-222222222222" as SessionId;
const SEED_TS = "2026-05-09T00:00:00.000Z";

let store: string;
let hookLogPath: string;

beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "megasaver-hooks-status-"));
  hookLogPath = join(store, "claude-tool-calls.jsonl");
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
});

afterEach(async () => {
  await rm(store, { recursive: true, force: true });
});

function seedEvent(overrides: Partial<TokenSaverEvent> = {}): void {
  appendEvent({
    store: { root: store },
    event: {
      id: `e-${Math.random()}`,
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      createdAt: "2026-05-10T12:00:00.000Z",
      sourceKind: "file",
      label: "read",
      rawBytes: 1000,
      returnedBytes: 200,
      bytesSaved: 800,
      savingRatio: 0.8,
      summary: "s",
      mode: "balanced",
      ...overrides,
    } as TokenSaverEvent,
    secretsRedacted: 0,
    chunksStored: 1,
  });
}

type RunResult = { out: string[]; err: string[]; code: number };

async function run(args: {
  json?: boolean;
  hookLogPath?: string;
  settingsPath?: string;
}): Promise<RunResult> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runHooksStatus({
    sessionId: SESSION_ID,
    storeFlag: store,
    cwd: store,
    home: "/tmp",
    xdgDataHome: undefined,
    platform: "linux",
    localAppData: undefined,
    hookLogPath: args.hookLogPath ?? hookLogPath,
    ...(args.settingsPath !== undefined ? { settingsPath: args.settingsPath } : {}),
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
    json: args.json ?? false,
  } as never);
  return { out, err, code };
}

describe("runHooksStatus — adoption (no hook log)", () => {
  it("forwards --settings through the public command before reporting advice visibility", async () => {
    const settingsPath = join(store, "custom-settings.json");
    await writeFile(
      settingsPath,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              hooks: [{ type: "command", command: "mega hooks log", timeout: 10 }],
            },
            {
              hooks: [{ type: "command", command: "mega hooks cache-advice", timeout: 10 }],
            },
          ],
          PostToolUse: [
            {
              hooks: [{ type: "command", command: "mega hooks saver", timeout: 30 }],
            },
          ],
          UserPromptSubmit: [
            {
              hooks: [{ type: "command", command: "mega hooks intent", timeout: 10 }],
            },
          ],
        },
      }),
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("HOME", join(store, "default-home"));
    process.exitCode = 0;
    try {
      await hooksStatusCommand.run?.({
        args: { store, settings: settingsPath, json: true },
        cmd: hooksStatusCommand,
        rawArgs: ["--store", store, "--settings", settingsPath, "--json"],
        data: undefined,
      } as never);

      const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
      expect(payload.hookInstallation).toMatchObject({
        connected: true,
        cacheAdviceInstalled: true,
      });
      expect(errorSpy).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(0);
    } finally {
      process.exitCode = 0;
      vi.unstubAllEnvs();
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it("exposes optional cache-advice installation separately from core connected", async () => {
    const settingsPath = join(store, "settings.json");
    await writeFile(
      settingsPath,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "core",
              hooks: [{ type: "command", command: "mega hooks log", timeout: 10 }],
            },
          ],
          PostToolUse: [
            {
              matcher: "core",
              hooks: [{ type: "command", command: "mega hooks saver", timeout: 30 }],
            },
          ],
          UserPromptSubmit: [
            { hooks: [{ type: "command", command: "mega hooks intent", timeout: 10 }] },
          ],
        },
      }),
    );
    seedEvent();

    const { out, code } = await run({ json: true, settingsPath });
    const payload = JSON.parse(out.join("\n"));

    expect(code).toBe(0);
    expect(payload.hookInstallation).toMatchObject({
      connected: true,
      cacheAdviceInstalled: false,
    });
  });

  it("emits adoption JSON with null interception and the install hint", async () => {
    seedEvent({ sourceKind: "file" });
    seedEvent({ sourceKind: "command" });
    const { out, code } = await run({
      json: true,
      hookLogPath: join(store, "does-not-exist.jsonl"),
    });
    expect(code).toBe(0);
    const payload = JSON.parse(out.join("\n"));
    expect(payload.adoption.proxy_call_count).toBe(2);
    expect(payload.interception).toBeNull();
    expect(payload.interception_hint).toBe(
      "Proxy adoption metrics only. Claude Code hook telemetry not configured. Run: mega hooks install claude-code",
    );
  });

  it("shows the install suggestion in text mode when no hook log exists", async () => {
    seedEvent();
    const { out, code } = await run({ hookLogPath: join(store, "nope.jsonl") });
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("Run: mega hooks install claude-code");
    expect(text.toLowerCase()).toContain("adoption");
    expect(text.toLowerCase()).not.toContain("interception rate:");
  });
});

describe("runHooksStatus — interception (hook log present)", () => {
  it("includes a populated interception block when the hook log exists", async () => {
    seedEvent({ sourceKind: "file" });
    seedEvent({ sourceKind: "command" });
    seedEvent({ sourceKind: "fetch" });
    await writeFile(
      hookLogPath,
      [
        `{"tool":"Read","category":"eligible_read"}`,
        `{"tool":"Bash","category":"eligible_command"}`,
      ].join("\n"),
    );
    const { out, code } = await run({ json: true });
    expect(code).toBe(0);
    const payload = JSON.parse(out.join("\n"));
    expect(payload.interception).not.toBeNull();
    // 3 proxy-eligible, 2 native -> 3/5 = 0.6
    expect(payload.interception.hook_interception_rate).toBeCloseTo(0.6);
  });

  it("renders adoption and interception as distinct labels in text mode", async () => {
    seedEvent({ sourceKind: "file" });
    await writeFile(hookLogPath, `{"tool":"Read","category":"eligible_read"}`);
    const { out } = await run({});
    const text = out.join("\n").toLowerCase();
    expect(text).toContain("adoption");
    expect(text).toContain("interception");
  });
});

describe("runHooksStatus — honest metrics wording", () => {
  it("never implies a universal interception rate when no hook log exists", async () => {
    seedEvent();
    const { out } = await run({ hookLogPath: join(store, "missing.jsonl") });
    const text = out.join("\n").toLowerCase();
    // "universal" may describe ADOPTION (which is universal) but must never be
    // paired with interception, and no interception number may appear.
    expect(text).not.toMatch(/universal interception/);
    expect(text).not.toMatch(/interception rate: \d/);
  });
});

const OVERLAY_ID = "33333333-3333-4333-8333-333333333333";
const WK1 = "000000000000a1fa";
const WK2 = "000000000000be7a";

async function seedOverlaySummary(
  wk: string,
  id: string,
  eventsTotal: number,
  bytesSaved: number,
  deltaBytesTotal?: number,
): Promise<void> {
  await mkdir(join(store, "stats", wk), { recursive: true });
  await writeFile(
    join(store, "stats", wk, `${id}.json`),
    JSON.stringify({
      liveSessionId: id,
      eventsTotal,
      rawBytesTotal: bytesSaved + 100,
      returnedBytesTotal: 100,
      bytesSavedTotal: bytesSaved,
      ...(deltaBytesTotal !== undefined ? { deltaBytesTotal } : {}),
      savingRatio: bytesSaved / (bytesSaved + 100),
      secretsRedactedTotal: 0,
      chunksStoredTotal: 1,
      updatedAt: "2026-07-10T00:00:00.000Z",
    }),
  );
}

type StatusOverrides = { sessionId?: string; json?: boolean };
async function runStatus(overrides: StatusOverrides = {}): Promise<RunResult> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runHooksStatus({
    ...(overrides.sessionId !== undefined ? { sessionId: overrides.sessionId } : {}),
    storeFlag: store,
    cwd: store,
    home: "/tmp",
    xdgDataHome: undefined,
    platform: "linux",
    localAppData: undefined,
    hookLogPath: join(store, "none.jsonl"),
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    json: overrides.json ?? false,
  });
  return { out, err, code };
}

describe("runHooksStatus — overlay keyspace union (E27)", () => {
  it("renders an overlay-backed block for a hook-only session id", async () => {
    await seedOverlaySummary(WK1, OVERLAY_ID, 2, 900);
    const { out, err, code } = await runStatus({ sessionId: OVERLAY_ID });
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("Live hook session (overlay)");
    expect(text).toContain(WK1);
    expect(text).toContain("events: 2");
    expect(err).toHaveLength(0);
  });

  it("emits the overlay summary as JSON with its source label", async () => {
    await seedOverlaySummary(WK1, OVERLAY_ID, 2, 900);
    const { out, code } = await runStatus({ sessionId: OVERLAY_ID, json: true });
    expect(code).toBe(0);
    const p = JSON.parse(out.join("\n"));
    expect(p.source).toBe("overlay");
    expect(p.workspaceKey).toBe(WK1);
    expect(p.eventsTotal).toBe(2);
  });

  it("still reports session not found when BOTH keyspaces miss", async () => {
    const { err, code } = await runStatus({
      sessionId: "44444444-4444-4444-8444-444444444444",
    });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("not found");
  });

  it("headlines net bytes with the gross − re-fetched breakdown when deltas are recorded", async () => {
    await seedOverlaySummary(WK1, OVERLAY_ID, 2, 900, 700);
    const { out, code } = await runStatus({ sessionId: OVERLAY_ID });
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain(
      "saved: 700 B net (900 B saved − 200 B re-fetched + overhead, 90.0% gross)",
    );
  });

  it("falls back to the gross line when the summary predates signed deltas", async () => {
    await seedOverlaySummary(WK1, OVERLAY_ID, 2, 900);
    const { out, code } = await runStatus({ sessionId: OVERLAY_ID });
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("(saved 90.0%)");
    expect(text).not.toContain("re-fetched");
  });
});

describe("runHooksStatus — cross-workspace aggregate (E28, no-arg form)", () => {
  it("sums totals across workspace keys and prints heartbeat recency", async () => {
    await seedOverlaySummary(WK1, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 2, 900);
    await seedOverlaySummary(WK2, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", 3, 100);
    const ts = new Date(Date.now() - 1000).toISOString();
    recordInvocationHeartbeat(store, WK1, ts);
    const { out, code } = await runStatus();
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain(`${WK1}: 1 sessions, 2 events, net saved 900 B`);
    expect(text).toContain(`${WK2}: 1 sessions, 3 events, net saved 100 B`);
    expect(text).toContain("TOTAL: 2 sessions across 2 workspaces, net saved 1000 B");
    expect(text).toContain(`${WK1}: invoked ${ts}, completed never, failures 0`);
  });

  it("headlines net totals with the gross − re-fetched breakdown", async () => {
    await seedOverlaySummary(WK1, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 2, 900, 700);
    await seedOverlaySummary(WK2, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", 3, 100, 100);
    const { out, code } = await runStatus();
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain(
      `${WK1}: 1 sessions, 2 events, net saved 700 B (900 B saved − 200 B re-fetched + overhead, 90.0% gross)`,
    );
    expect(text).toContain(
      `${WK2}: 1 sessions, 3 events, net saved 100 B (100 B saved − 0 B re-fetched + overhead, 50.0% gross)`,
    );
    expect(text).toContain(
      "TOTAL: 2 sessions across 2 workspaces, net saved 800 B (1000 B saved − 200 B re-fetched + overhead, 83.3% gross)",
    );
  });

  it("renders an empty store without erroring", async () => {
    const { out, code } = await runStatus();
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("no hook sessions recorded");
  });
});
