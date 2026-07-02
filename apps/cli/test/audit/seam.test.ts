import { EventEmitter } from "node:events";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type RunCommandSpawn,
  type RunOutputExecInput,
  createJsonDirectoryCoreRegistry,
  initStore,
  runOutputExecCommand,
} from "@megasaver/core";
import type { SessionFailureId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAuditSeam } from "../../src/commands/audit/seam.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_A = "22222222-2222-4222-8222-222222222222";
const SESSION_B = "44444444-4444-4444-8444-444444444444";
const TS = "2026-07-02T12:00:00.000Z";

let root: string;
const lines: string[] = [];
const stdout = (l: string) => lines.push(l);
const stderr = (l: string) => lines.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-seam-"));
  lines.length = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

function env() {
  return {
    storeFlag: root,
    cwd: root,
    home: root,
    xdgDataHome: undefined as string | undefined,
    platform: process.platform as NodeJS.Platform,
    localAppData: undefined as string | undefined,
  };
}

async function seedProject(): Promise<void> {
  await initStore(root);
  const registry = createJsonDirectoryCoreRegistry({ rootDir: root });
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: root,
    createdAt: TS,
    updatedAt: TS,
  } as never);
}

type EngineScore = {
  baseRelevance: number;
  memoryBoost: number;
  failureHistoryBoost: number;
  finalScore: number;
};
type ChunkRef = { startLine: number; endLine: number; score: number; engine?: EngineScore };

const engine = (failure: number, memory: number): EngineScore => ({
  baseRelevance: 1,
  memoryBoost: memory,
  failureHistoryBoost: failure,
  finalScore: 0.7 + 0.15 * memory + 0.15 * failure,
});

function fixtureTrace(input: {
  sessionId: string;
  engineRanking: boolean;
  chunks: ChunkRef[];
  rawTokens: number;
  returnedTokens: number;
}) {
  return {
    sessionId: input.sessionId,
    projectId: PROJECT_ID,
    toolName: "proxy_run_command",
    createdAt: TS,
    ranking: {
      classification: { category: "generic_shell", confidence: 1 },
      decision: "compressed",
      compressor: "generic",
      engineRanking: input.engineRanking,
      rawTokens: input.rawTokens,
      returnedTokens: input.returnedTokens,
      candidates: input.chunks,
      selected: input.chunks,
      omitted: [],
    },
  };
}

function writeTrace(sessionId: string, trace: unknown): void {
  const dir = join(root, "stats", PROJECT_ID, `${sessionId}-traces`);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "replay-traces.jsonl"), `${JSON.stringify(trace)}\n`, "utf8");
}

function seedFixtureTraces(): void {
  writeTrace(
    SESSION_A,
    fixtureTrace({
      sessionId: SESSION_A,
      engineRanking: true,
      chunks: [{ startLine: 1, endLine: 3, score: 5, engine: engine(0.5, 0) }],
      rawTokens: 1000,
      returnedTokens: 200,
    }),
  );
  writeTrace(
    SESSION_A,
    fixtureTrace({
      sessionId: SESSION_A,
      engineRanking: true,
      chunks: [
        { startLine: 1, endLine: 2, score: 4, engine: engine(0, 0.25) },
        { startLine: 3, endLine: 4, score: 3, engine: engine(0, 0.75) },
      ],
      rawTokens: 500,
      returnedTokens: 100,
    }),
  );
  writeTrace(
    SESSION_B,
    fixtureTrace({
      sessionId: SESSION_B,
      engineRanking: false,
      chunks: [{ startLine: 1, endLine: 2, score: 2 }],
      rawTokens: 300,
      returnedTokens: 300,
    }),
  );
}

describe("mega audit seam", () => {
  it("splits fire rates, boosts and token sums by engine-ranking arm", async () => {
    await seedProject();
    seedFixtureTraces();
    const code = await runAuditSeam({
      projectName: "demo",
      sessionFlag: undefined,
      ...env(),
      stdout,
      stderr,
      json: true,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(lines.join("\n"));
    expect(parsed.traces).toBe(3);
    expect(parsed.seamOn.traces).toBe(2);
    expect(parsed.seamOn.failureBoostFired).toBe(1);
    expect(parsed.seamOn.memoryBoostFired).toBe(1);
    expect(parsed.seamOn.meanFailureBoostFired).toBeCloseTo(0.5, 10);
    expect(parsed.seamOn.meanMemoryBoostFired).toBeCloseTo(0.5, 10);
    expect(parsed.seamOn.rawTokens).toBe(1500);
    expect(parsed.seamOn.returnedTokens).toBe(300);
    expect(parsed.seamOff.traces).toBe(1);
    expect(parsed.seamOff.failureBoostFired).toBe(0);
    expect(parsed.seamOff.memoryBoostFired).toBe(0);
    expect(parsed.seamOff.meanFailureBoostFired).toBe(0);
    expect(parsed.seamOff.meanMemoryBoostFired).toBe(0);
    expect(parsed.seamOff.rawTokens).toBe(300);
    expect(parsed.seamOff.returnedTokens).toBe(300);
  });

  it("renders a plain-text report with one section per arm", async () => {
    await seedProject();
    seedFixtureTraces();
    const code = await runAuditSeam({
      projectName: "demo",
      sessionFlag: undefined,
      ...env(),
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    const out = lines.join("\n");
    expect(out).toContain("traces analyzed:");
    expect(out).toContain("3");
    expect(out).toContain("seam ON arm:");
    expect(out).toContain("seam OFF arm:");
    expect(out).toContain("2/3");
    expect(out).toContain("1/3");
    expect(out).toContain("failure boost fired:");
    expect(out).toContain("1/2");
    expect(out).toContain("memory boost fired:");
  });

  it("marks an empty arm instead of dividing by zero", async () => {
    await seedProject();
    seedFixtureTraces();
    const code = await runAuditSeam({
      projectName: "demo",
      sessionFlag: SESSION_A,
      ...env(),
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    const out = lines.join("\n");
    expect(out).toContain("seam ON arm:");
    expect(out).toContain("seam OFF arm:");
    expect(out).toContain("no traces in this arm");
    expect(out).not.toContain("NaN");
  });

  it("filters to one session with --session", async () => {
    await seedProject();
    seedFixtureTraces();
    const code = await runAuditSeam({
      projectName: "demo",
      sessionFlag: SESSION_B,
      ...env(),
      stdout,
      stderr,
      json: true,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(lines.join("\n"));
    expect(parsed.traces).toBe(1);
    expect(parsed.seamOn.traces).toBe(0);
    expect(parsed.seamOff.traces).toBe(1);
    expect(parsed.seamOff.failureBoostFired).toBe(0);
  });

  it("reports the onboarding hint when no traces exist", async () => {
    await seedProject();
    const code = await runAuditSeam({
      projectName: "demo",
      sessionFlag: undefined,
      ...env(),
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("No seam traces recorded yet");
    expect(lines.join("\n")).toContain("MEGASAVER_SEAM_TRACE=true");
  });

  it("exits 1 for an unknown project", async () => {
    await seedProject();
    const code = await runAuditSeam({
      projectName: "ghost",
      sessionFlag: undefined,
      ...env(),
      stdout,
      stderr,
    });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("ghost");
  });
});

// Integration (spec §P2.6 testing): a seam-on exec whose output references a
// prior session failure records a trace that audit seam reports as fired.
describe("mega audit seam — end to end over a real exec trace", () => {
  type FakeChild = EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
    killed: boolean;
  };
  function makeChild(): FakeChild {
    const c = new EventEmitter() as FakeChild;
    c.stdout = new EventEmitter();
    c.stderr = new EventEmitter();
    c.killed = false;
    c.kill = vi.fn(() => {
      c.killed = true;
      return true;
    });
    return c;
  }

  it("reports a non-zero failure-boost fire rate for a seam-boosted output", async () => {
    // Trace recording is opt-in since fix batch B — the e2e run must enable it.
    vi.stubEnv("MEGASAVER_SEAM_TRACE", "true");
    await seedProject();
    const failure = {
      id: "33333333-3333-4333-8333-333333333333" as SessionFailureId,
      projectId: PROJECT_ID,
      sessionId: SESSION_A,
      command: "pnpm tsc",
      errorOutput: "error TS2322: Type 'string' is not assignable at src/auth.ts:42",
      source: "proxy-classifier" as const,
      createdAt: TS,
    };
    const orchestratorRegistry: RunOutputExecInput["registry"] = {
      getSession: (id) =>
        id === SESSION_A
          ? {
              projectId: PROJECT_ID as never,
              tokenSaver: { mode: "balanced", storeRawOutput: true },
            }
          : null,
      getProject: (id) => ((id as string) === PROJECT_ID ? { rootPath: root } : null),
      createSessionFailure: (f) => f,
      listSessionFailures: () => [failure as never],
      listMemoryEntries: () => [],
      listProjectRules: () => [],
    };

    const child = makeChild();
    const p = runOutputExecCommand({
      registry: orchestratorRegistry,
      storeRoot: root,
      sessionId: SESSION_A as SessionId,
      command: "pnpm",
      args: ["test"],
      intent: "auth token validation",
      originPid: String(process.pid),
      timeoutMs: 300_000,
      maxBytes: 20_000_000,
      now: () => TS,
      newId: () => "cs-seam-e2e",
      loadPermissions: () => null,
      spawn: ((_c: string, _a: readonly string[], _o: Record<string, unknown>) =>
        child) as unknown as RunCommandSpawn,
    });
    child.stdout.emit(
      "data",
      Buffer.from("token validation logic lives in src/auth.ts near the session refresh\n"),
    );
    child.emit("close", 0);
    const res = await p;
    expect(res.ok).toBe(true);

    const code = await runAuditSeam({
      projectName: "demo",
      sessionFlag: SESSION_A,
      ...env(),
      stdout,
      stderr,
      json: true,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(lines.join("\n"));
    expect(parsed.traces).toBe(1);
    expect(parsed.seamOn.traces).toBe(1);
    expect(parsed.seamOn.failureBoostFired).toBeGreaterThan(0);
    expect(parsed.seamOn.meanFailureBoostFired).toBeGreaterThan(0);
    expect(parsed.seamOff.traces).toBe(0);
  });
});
