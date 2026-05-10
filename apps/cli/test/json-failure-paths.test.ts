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
import { runSessionCreate } from "../src/commands/session/create.js";
import { runSessionEnd } from "../src/commands/session/end.js";
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
