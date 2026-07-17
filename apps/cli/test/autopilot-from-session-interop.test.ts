import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_AUTOPILOT_POLICY,
  createJsonDirectoryCoreRegistry,
  runAutopilot,
} from "@megasaver/core";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMemoryFromSession } from "../src/commands/memory/from-session.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-06-30T00:00:00.000Z";
const NOW = "2026-06-30T12:00:00.000Z";
const FA_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FA_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let store: string;
let out: string[];
let err: string[];

function failure(id: string, over: Record<string, unknown>): string {
  return JSON.stringify({
    id,
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    task: "fix login",
    failedStep: "run auth tests",
    relatedFiles: [],
    convertedToRule: false,
    createdAt: TS,
    ...over,
  });
}

function env(over: Record<string, unknown> = {}) {
  return {
    sessionId: SESSION_ID,
    storeFlag: store,
    cwd: store,
    home: store,
    xdgDataHome: undefined,
    platform: process.platform,
    localAppData: undefined,
    jsonFlag: false,
    now: NOW,
    stdout: (l: string) => out.push(l),
    stderr: (l: string) => err.push(l),
    ...over,
  };
}

async function seed(): Promise<void> {
  await mkdir(join(store, "memory"), { recursive: true });
  await mkdir(join(store, "failed-attempts"), { recursive: true });
  await writeFile(
    join(store, "projects.json"),
    JSON.stringify([
      { id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: TS, updatedAt: TS },
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
        title: "demo session",
        startedAt: TS,
        endedAt: null,
      },
    ]),
  );
  await writeFile(
    join(store, "failed-attempts", `${PROJECT_ID}.jsonl`),
    `${[
      failure(FA_A, { failedStep: "run auth tests", errorOutput: "boom 401" }),
      failure(FA_B, {
        failedStep: "build the cli bundle",
        errorOutput: "ENOENT: missing dist/cli.js",
      }),
    ].join("\n")}\n`,
  );
}

async function countMemories(): Promise<number> {
  const raw = await readFile(join(store, "memory", `${PROJECT_ID}.jsonl`), "utf8").catch(() => "");
  return raw.split("\n").filter((l) => l.trim().length > 0).length;
}

function autopilot() {
  let n = 0;
  return runAutopilot({
    registry: createJsonDirectoryCoreRegistry({ rootDir: store }),
    projectId: PROJECT_ID as ProjectId,
    sessionId: SESSION_ID as SessionId,
    policy: DEFAULT_AUTOPILOT_POLICY,
    now: NOW,
    newId: () => {
      n += 1;
      return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    },
  });
}

beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "mega-cli-autopilot-interop-"));
  out = [];
  err = [];
});

afterEach(async () => {
  await rm(store, { recursive: true, force: true });
});

describe("autopilot and from-session share one idempotence ledger", () => {
  it("from-session first, then autopilot: everything skipped", async () => {
    await seed();
    expect(await runMemoryFromSession(env())).toBe(0);
    expect(await countMemories()).toBe(2);

    const result = await autopilot();
    expect(result).toEqual({ autoApproved: [], staged: [], skippedExisting: 2, cappedOut: 0 });
    expect(await countMemories()).toBe(2);
  });

  it("autopilot first, then from-session: a no-op", async () => {
    await seed();
    const result = await autopilot();
    // No prior session in this store, so both candidates stage (M2).
    expect(result.staged).toHaveLength(2);
    expect(result.autoApproved).toEqual([]);
    expect(await countMemories()).toBe(2);

    expect(await runMemoryFromSession(env())).toBe(0);
    expect(await countMemories()).toBe(2);
    expect(out.join("\n")).toContain("suggested=0");
    expect(out.join("\n")).toContain("skipped=2");
  });
});
