/**
 * --json failure-path tests (Item 3 of DD1 AA cleanup batch).
 *
 * Each --json command must emit text stderr + exit 1 on failure paths.
 * No JSON is written to stdout in any of these cases.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runConnectorStatus } from "../src/commands/connector/index.js";
import { runMemoryList } from "../src/commands/memory/list.js";
import { runMemoryShow } from "../src/commands/memory/show.js";
import { runProjectCreate, runProjectList } from "../src/commands/project.js";

// ---------------------------------------------------------------------------
// project list --json — failure path
// ---------------------------------------------------------------------------

describe("runProjectList --json failure path", () => {
  it("store error → text stderr, no stdout, exit 1", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runProjectList({
      storeFlag: "  ", // whitespace-only triggers store validation error
      cwd: "/tmp",
      home: "/tmp",
      xdgDataHome: undefined,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
      json: true,
    });
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.length).toBeGreaterThan(0);
    // stderr must be plain text, not JSON
    for (const line of err) {
      expect(() => JSON.parse(line)).toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// project create --json — failure path
// ---------------------------------------------------------------------------

describe("runProjectCreate --json failure path", () => {
  let store: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-json-fail-create-"));
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  it("invalid name → text stderr, no stdout, exit 1", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runProjectCreate({
      name: "   ", // whitespace-only → name must be non-empty
      storeFlag: store,
      rootFlag: undefined,
      cwd: "/tmp",
      home: "/tmp",
      xdgDataHome: undefined,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
      json: true,
    });
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.length).toBeGreaterThan(0);
    expect(err[0]).toContain("error:");
    for (const line of err) {
      expect(() => JSON.parse(line)).toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// memory list --json — failure path
// ---------------------------------------------------------------------------

describe("runMemoryList --json failure path", () => {
  let store: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-json-fail-memlist-"));
    await mkdir(store, { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "demo",
          rootPath: "/tmp",
          createdAt: "2026-05-10T00:00:00.000Z",
          updatedAt: "2026-05-10T00:00:00.000Z",
        },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  it("nonexistent project → text stderr, no stdout, exit 1", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runMemoryList({
      projectName: "no-such-project",
      storeFlag: store,
      jsonFlag: true,
      cwd: "/tmp",
      home: "/tmp",
      xdgDataHome: undefined,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
    });
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.length).toBeGreaterThan(0);
    expect(err.some((e) => /not found/.test(e))).toBe(true);
    for (const line of err) {
      expect(() => JSON.parse(line)).toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// memory show --json — failure path
// ---------------------------------------------------------------------------

describe("runMemoryShow --json failure path", () => {
  let store: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-json-fail-memshow-"));
    await mkdir(store, { recursive: true });
    await writeFile(join(store, "projects.json"), "[]");
    await writeFile(join(store, "sessions.json"), "[]");
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  it("not-found UUID → text stderr, no stdout, exit 1", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runMemoryShow({
      memoryEntryId: "99999999-9999-4999-8999-999999999999",
      storeFlag: store,
      jsonFlag: true,
      cwd: "/tmp",
      home: "/tmp",
      xdgDataHome: undefined,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
    });
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.length).toBeGreaterThan(0);
    for (const line of err) {
      expect(() => JSON.parse(line)).toThrow();
    }
  });

  it("invalid id (not a UUID) → text stderr, no stdout, exit 1", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runMemoryShow({
      memoryEntryId: "not-a-uuid",
      storeFlag: store,
      jsonFlag: true,
      cwd: "/tmp",
      home: "/tmp",
      xdgDataHome: undefined,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
    });
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.length).toBeGreaterThan(0);
    for (const line of err) {
      expect(() => JSON.parse(line)).toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// connector status --json — failure path
// ---------------------------------------------------------------------------

describe("runConnectorStatus --json failure path", () => {
  let store: string;
  let projectRoot: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-json-fail-cstatus-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-json-fail-cstatus-root-"));
    await mkdir(store, { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "demo",
          rootPath: projectRoot,
          createdAt: "2026-05-10T00:00:00.000Z",
          updatedAt: "2026-05-10T00:00:00.000Z",
        },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("nonexistent project → text stderr, no stdout, exit 1", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runConnectorStatus({
      projectName: "no-such-project",
      targetFlag: undefined,
      storeFlag: store,
      cwd: projectRoot,
      home: "/tmp",
      xdgDataHome: undefined,
      json: true,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
    });
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.length).toBeGreaterThan(0);
    expect(err.some((e) => /not found/.test(e))).toBe(true);
    for (const line of err) {
      expect(() => JSON.parse(line)).toThrow();
    }
  });

  it("invalid --target with --json → text stderr, no stdout, exit 1", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runConnectorStatus({
      projectName: "demo",
      targetFlag: "bogus-target",
      storeFlag: store,
      cwd: projectRoot,
      home: "/tmp",
      xdgDataHome: undefined,
      json: true,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
    });
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.length).toBeGreaterThan(0);
    expect(err.some((e) => /invalid target/.test(e))).toBe(true);
    for (const line of err) {
      expect(() => JSON.parse(line)).toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// write-side --json failure paths (5 commands)
// ---------------------------------------------------------------------------

import { runConnectorSync } from "../src/commands/connector/sync.js";
import { runMemoryCreate } from "../src/commands/memory/create.js";
import { runOutputChunk } from "../src/commands/output/chunk.js";
import { runOutputExec } from "../src/commands/output/exec.js";
import { runOutputFile } from "../src/commands/output/file.js";
import { runOutputFilter } from "../src/commands/output/filter.js";
import { runSessionCreate } from "../src/commands/session/create.js";
import { runSessionEnd } from "../src/commands/session/end.js";
import {
  runSessionSaverDisable,
  runSessionSaverEnable,
} from "../src/commands/session/saver/index.js";
import { runSessionUpdate } from "../src/commands/session/update.js";

const PROJECT_ID_W = "11111111-1111-4111-8111-111111111111";
const TS_W = "2026-05-09T00:00:00.000Z";

async function seedProject(store: string, projectRoot: string): Promise<void> {
  await mkdir(store, { recursive: true });
  await writeFile(
    join(store, "projects.json"),
    JSON.stringify([
      { id: PROJECT_ID_W, name: "demo", rootPath: projectRoot, createdAt: TS_W, updatedAt: TS_W },
    ]),
  );
  await writeFile(join(store, "sessions.json"), "[]");
}

function nonJsonStderr(err: string[]): void {
  expect(err.length).toBeGreaterThan(0);
  for (const line of err) {
    expect(() => JSON.parse(line)).toThrow();
  }
}

describe("runSessionCreate --json failure path", () => {
  let store: string;
  let projectRoot: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-json-fail-sc-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-json-fail-sc-root-"));
    await seedProject(store, projectRoot);
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("invalid agent → text stderr, no stdout, exit 1", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runSessionCreate({
      projectName: "demo",
      agent: "bogus",
      risk: "medium",
      title: undefined,
      storeFlag: store,
      cwd: projectRoot,
      home: "/tmp",
      xdgDataHome: undefined,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
      json: true,
    });
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    nonJsonStderr(err);
  });
});

describe("runSessionEnd --json failure path", () => {
  let store: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-json-fail-se-"));
    await seedProject(store, "/tmp");
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  it("nonexistent session → text stderr, no stdout, exit 1", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runSessionEnd({
      sessionId: "99999999-9999-4999-8999-999999999999",
      storeFlag: store,
      cwd: "/tmp",
      home: "/tmp",
      xdgDataHome: undefined,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
      json: true,
    });
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    nonJsonStderr(err);
  });
});

describe("runSessionUpdate --json failure path", () => {
  let store: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-json-fail-su-"));
    await seedProject(store, "/tmp");
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  it("nonexistent session with valid title → text stderr, no stdout, exit 1", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runSessionUpdate({
      sessionId: "99999999-9999-4999-8999-999999999999",
      titleFlag: "renamed",
      riskFlag: undefined,
      agentFlag: undefined,
      storeFlag: store,
      cwd: "/tmp",
      home: "/tmp",
      xdgDataHome: undefined,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
      json: true,
    });
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    nonJsonStderr(err);
  });
});

describe("runMemoryCreate --json failure path", () => {
  let store: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-json-fail-mc-"));
    await seedProject(store, "/tmp");
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  it("project not found → text stderr, no stdout, exit 1", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runMemoryCreate({
      projectName: "missing",
      scopeFlag: "project",
      contentFlag: "x",
      sessionFlag: undefined,
      storeFlag: store,
      cwd: "/tmp",
      home: "/tmp",
      xdgDataHome: undefined,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
      json: true,
    });
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    nonJsonStderr(err);
  });
});

describe("runConnectorSync --json failure path", () => {
  let store: string;
  let projectRoot: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-json-fail-sync-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-json-fail-sync-root-"));
    await seedProject(store, projectRoot);
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("invalid --target flag → text stderr, no stdout, exit 1", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runConnectorSync({
      projectName: "demo",
      targetFlag: "bogus",
      storeFlag: store,
      cwd: projectRoot,
      home: "/tmp",
      xdgDataHome: undefined,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
      json: true,
    });
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    nonJsonStderr(err);
  });
});

// ---------------------------------------------------------------------------
// session saver enable/disable --json failure paths (BB2)
// ---------------------------------------------------------------------------

const SESS_SAVER = "22222222-2222-4222-8222-222222222222";

async function seedSaverSession(store: string): Promise<void> {
  await writeFile(
    join(store, "sessions.json"),
    JSON.stringify([
      {
        id: SESS_SAVER,
        projectId: PROJECT_ID_W,
        agentId: "claude-code",
        riskLevel: "medium",
        title: null,
        startedAt: TS_W,
        endedAt: null,
      },
    ]),
  );
}

describe("runSessionSaverEnable --json failure path", () => {
  let store: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-json-fail-saver-en-"));
    await seedProject(store, "/tmp");
    await seedSaverSession(store);
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  it("invalid --mode → text stderr, no stdout, exit 1", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runSessionSaverEnable({
      sessionId: SESS_SAVER,
      modeFlag: "turbo",
      storeFlag: store,
      cwd: "/tmp",
      home: "/tmp",
      xdgDataHome: undefined,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
      json: true,
    });
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    nonJsonStderr(err);
  });

  it("missing --mode → text stderr, no stdout, exit 1", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runSessionSaverEnable({
      sessionId: SESS_SAVER,
      modeFlag: undefined,
      storeFlag: store,
      cwd: "/tmp",
      home: "/tmp",
      xdgDataHome: undefined,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
      json: true,
    });
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    nonJsonStderr(err);
  });
});

describe("runSessionSaverDisable --json failure path", () => {
  let store: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-json-fail-saver-dis-"));
    await seedProject(store, "/tmp");
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  it("nonexistent session → text stderr, no stdout, exit 1", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runSessionSaverDisable({
      sessionId: "99999999-9999-4999-8999-999999999999",
      modeFlag: undefined,
      storeFlag: store,
      cwd: "/tmp",
      home: "/tmp",
      xdgDataHome: undefined,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
      json: true,
    });
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    nonJsonStderr(err);
  });
});

// ---------------------------------------------------------------------------
// output file / filter / chunk --json failure paths (BB7a §4)
// ---------------------------------------------------------------------------

const SESSION_ID_W = "22222222-2222-4222-8222-222222222222";

async function seedSession(store: string, projectRoot: string): Promise<void> {
  await seedProject(store, projectRoot);
  await writeFile(
    join(store, "sessions.json"),
    JSON.stringify([
      {
        id: SESSION_ID_W,
        projectId: PROJECT_ID_W,
        agentId: "claude-code",
        riskLevel: "medium",
        title: "demo session",
        startedAt: TS_W,
        endedAt: null,
      },
    ]),
  );
}

describe("runOutputFile --json failure path", () => {
  let store: string;
  let projectRoot: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-json-fail-of-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-json-fail-of-root-"));
    await seedSession(store, projectRoot);
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("missing --intent → text stderr, no stdout, exit 1", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runOutputFile({
      sessionId: SESSION_ID_W,
      intentFlag: undefined,
      path: join(projectRoot, "log.txt"),
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
      json: true,
    });
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    nonJsonStderr(err);
  });
});

describe("runOutputFilter --json failure path", () => {
  let store: string;
  let projectRoot: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-json-fail-ofl-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-json-fail-ofl-root-"));
    await seedSession(store, projectRoot);
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("missing --file → text stderr, no stdout, exit 1", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runOutputFilter({
      sessionId: SESSION_ID_W,
      intentFlag: "find it",
      fileFlag: undefined,
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
      json: true,
    });
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    nonJsonStderr(err);
  });
});

describe("runOutputChunk --json failure path", () => {
  let store: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-json-fail-oc-"));
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  it("unknown chunk-set id → text stderr, no stdout, exit 1", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runOutputChunk({
      chunkSetId: "does-not-exist",
      chunkId: "0",
      storeFlag: store,
      cwd: "/tmp",
      home: "/tmp",
      xdgDataHome: undefined,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
      json: true,
    });
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    nonJsonStderr(err);
  });
});

// ---------------------------------------------------------------------------
// output exec --json failure paths (BB7b) — each must write nothing to stdout
// and a plain-text stderr line; spawn must NEVER be reached on these branches.
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: spawn test double that must never run
const neverSpawn = (() => {
  throw new Error("spawn must never run on a failure path");
}) as any;

describe("runOutputExec --json failure path", () => {
  let store: string;
  let projectRoot: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-json-fail-oe-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-json-fail-oe-root-"));
    await seedSession(store, projectRoot);
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("missing --intent → text stderr, no stdout, exit 1", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runOutputExec({
      sessionId: SESSION_ID_W,
      intentFlag: undefined,
      command: "pnpm",
      args: ["test"],
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
      json: true,
      originPid: String(process.pid),
      spawn: neverSpawn,
    });
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    nonJsonStderr(err);
  });

  it("command denied (non-allowlisted) → text stderr, no stdout, exit 1", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runOutputExec({
      sessionId: SESSION_ID_W,
      intentFlag: "anything",
      command: "rmtree",
      args: [],
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
      json: true,
      originPid: String(process.pid),
      spawn: neverSpawn,
    });
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.some((e) => e.includes("command_denied"))).toBe(true);
    nonJsonStderr(err);
  });

  it("session not found → text stderr, no stdout, exit 1", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runOutputExec({
      sessionId: "99999999-9999-4999-8999-999999999999",
      intentFlag: "anything",
      command: "pnpm",
      args: ["test"],
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
      json: true,
      originPid: String(process.pid),
      spawn: neverSpawn,
    });
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    nonJsonStderr(err);
  });
});
