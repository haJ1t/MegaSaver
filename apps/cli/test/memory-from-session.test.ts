import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMemoryFromSession } from "../src/commands/memory/from-session.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_SESSION_ID = "44444444-4444-4444-8444-444444444444";
const TS = "2026-06-30T00:00:00.000Z";
const NOW = "2026-06-30T12:00:00.000Z";

const FA_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FA_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FA_DUP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FA_OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function failure(id: string, sessionId: string, over: Record<string, unknown>): string {
  return JSON.stringify({
    id,
    projectId: PROJECT_ID,
    sessionId,
    task: "fix login",
    failedStep: "run auth tests",
    relatedFiles: [],
    convertedToRule: false,
    createdAt: TS,
    ...over,
  });
}

let store: string;
let out: string[];
let err: string[];

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

async function seed(failures: string[]): Promise<void> {
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
    `${failures.join("\n")}\n`,
  );
}

type StoredMem = {
  id: string;
  approval: string;
  type: string;
  source: string;
  scope: string;
  sessionId: string | null;
  keywords: string[];
  relatedFiles?: string[];
};

async function readMemories(): Promise<StoredMem[]> {
  const raw = await readFile(join(store, "memory", `${PROJECT_ID}.jsonl`), "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as StoredMem);
}

beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "mega-cli-mem-from-session-"));
  out = [];
  err = [];
});

afterEach(async () => {
  await rm(store, { recursive: true, force: true });
});

describe("runMemoryFromSession", () => {
  it("stages suggested memories from the session's failures (dup collapsed)", async () => {
    await seed([
      failure(FA_A, SESSION_ID, {
        failedStep: "auth.test.ts > rejects expired token",
        errorOutput: "AssertionError: expected 200 to be 401",
        relatedFiles: ["src/middleware/auth.ts"],
      }),
      failure(FA_B, SESSION_ID, {
        failedStep: "build the cli bundle",
        errorOutput: "ENOENT: missing dist/cli.js",
      }),
      // identical content to FA_B's neighbour? no — duplicate of FA_A's title/content:
      failure(FA_DUP, SESSION_ID, {
        failedStep: "auth.test.ts > rejects expired token",
        errorOutput: "AssertionError: expected 200 to be 401",
        relatedFiles: ["src/middleware/auth.ts"],
      }),
      // a different session's failure must be ignored:
      failure(FA_OTHER, OTHER_SESSION_ID, { failedStep: "unrelated", errorOutput: "nope" }),
    ]);

    const code = await runMemoryFromSession(env());
    expect(code).toBe(0);

    const mems = await readMemories();
    expect(mems).toHaveLength(2);
    for (const m of mems) {
      expect(m.approval).toBe("suggested");
      expect(m.scope).toBe("session");
      expect(m.sessionId).toBe(SESSION_ID);
      expect(m.source).toBe("test_failure");
    }
    const test = mems.find((m) => m.type === "test_behavior");
    expect(test?.relatedFiles).toEqual(["src/middleware/auth.ts"]);
    expect(mems.some((m) => m.type === "bug")).toBe(true);
    expect(out.join("\n")).toContain("suggested=2");
  });

  it("is idempotent — a second run stages nothing", async () => {
    await seed([
      failure(FA_A, SESSION_ID, { failedStep: "run auth tests", errorOutput: "boom 401" }),
    ]);
    const first = await runMemoryFromSession(env());
    expect(first).toBe(0);
    expect((await readMemories()).length).toBe(1);

    out = [];
    const second = await runMemoryFromSession(env());
    expect(second).toBe(0);
    // No new memory created.
    expect((await readMemories()).length).toBe(1);
    expect(out.join("\n")).toContain("suggested=0");
    expect(out.join("\n")).toContain("skipped=1");
  });

  it("emits a JSON summary with --json", async () => {
    await seed([
      failure(FA_A, SESSION_ID, { failedStep: "run auth tests", errorOutput: "boom 401" }),
    ]);
    const code = await runMemoryFromSession(env({ jsonFlag: true }));
    expect(code).toBe(0);
    const summary = JSON.parse(out.join("")) as { suggested: number; skipped: number };
    expect(summary).toEqual({ suggested: 1, skipped: 0 });
  });

  it("returns exit 1 for an unknown session", async () => {
    await seed([
      failure(FA_A, SESSION_ID, { failedStep: "run auth tests", errorOutput: "boom 401" }),
    ]);
    const code = await runMemoryFromSession(
      env({ sessionId: "99999999-9999-4999-8999-999999999999" }),
    );
    expect(code).toBe(1);
    expect(err.join("\n").length).toBeGreaterThan(0);
  });
});
