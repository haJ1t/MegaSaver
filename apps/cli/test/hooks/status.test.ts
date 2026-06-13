import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TokenSaverEvent, appendEvent } from "@megasaver/core";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runHooksStatus } from "../../src/commands/hooks/status.js";

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

async function run(args: { json?: boolean; hookLogPath?: string }): Promise<RunResult> {
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
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    json: args.json ?? false,
  });
  return { out, err, code };
}

describe("runHooksStatus — adoption (no hook log)", () => {
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
