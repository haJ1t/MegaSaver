import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryCreateCommand, runMemoryCreate } from "../../src/commands/memory/create.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const RULE_ID = "22222222-2222-4222-8222-222222222222";
const DECISION_ID = "33333333-3333-4333-8333-333333333333";
const NEW_ID = "55555555-5555-4555-8555-555555555555";
const TS = "2026-07-01T00:00:00.000Z";
const NOW = "2026-07-13T00:00:00.000Z";

type StoredRow = {
  id: string;
  title?: string;
  validTo?: string | null;
  supersedesId?: string;
  evidence?: string[];
};

describe("mega memory create — supersession", () => {
  let store: string;
  const lines: string[] = [];
  const errLines: string[] = [];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
  const originalNodeEnv = process.env["NODE_ENV"];

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-create-supersede-"));
    lines.length = 0;
    errLines.length = 0;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    // biome-ignore lint/performance/noDelete: process.env clear semantics require delete
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    delete process.env["MEGA_TEST_MEMORY_ENTRY_ID"];
    // biome-ignore lint/performance/noDelete: process.env clear semantics require delete
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    delete process.env["MEGA_TEST_NOW"];
    // biome-ignore lint/performance/noDelete: restoring env to absent state requires delete
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    if (originalNodeEnv === undefined) delete process.env["NODE_ENV"];
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    else process.env["NODE_ENV"] = originalNodeEnv;
    await rm(store, { recursive: true, force: true });
  });

  async function seedStore(): Promise<void> {
    await mkdir(join(store, "memory"), { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
    const base = {
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      keywords: [],
      confidence: "high",
      source: "manual",
      stale: false,
      approval: "approved",
      relatedFiles: ["docs/install.md"],
      createdAt: TS,
      updatedAt: TS,
    };
    const rows = [
      {
        ...base,
        id: RULE_ID,
        type: "project_rule",
        title: "Use npm for installs",
        content: "use npm for installs",
      },
      {
        ...base,
        id: DECISION_ID,
        type: "decision",
        title: "Use npm",
        content: "use npm for installs",
      },
    ];
    await writeFile(
      join(store, "memory", `${PROJECT_ID}.jsonl`),
      `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
    );
  }

  async function readRows(): Promise<StoredRow[]> {
    const raw = await readFile(join(store, "memory", `${PROJECT_ID}.jsonl`), "utf8");
    return raw
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as StoredRow);
  }

  function makeInput(
    over: Partial<Parameters<typeof runMemoryCreate>[0]>,
  ): Parameters<typeof runMemoryCreate>[0] {
    return {
      projectName: "demo",
      scopeFlag: "project",
      contentFlag: "placeholder",
      sessionFlag: undefined,
      storeFlag: store,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
      home: process.env["HOME"] ?? "",
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      stdout: (line) => lines.push(line),
      stderr: (line) => errLines.push(line),
      newId: () => NEW_ID,
      now: () => NOW,
      ...over,
    };
  }

  it("born-approved contradiction links, closes, and prints the undo note", async () => {
    await seedStore();
    const code = await runMemoryCreate(
      makeInput({
        typeFlag: "project_rule",
        titleFlag: "Never use npm for installs",
        contentFlag: "use npm for installs",
        keywordFlags: ["never"],
        fileFlags: ["docs/install.md"],
      }),
    );
    expect(code).toBe(0);
    expect(lines).toEqual([NEW_ID]);
    const rows = await readRows();
    expect(rows.find((r) => r.id === NEW_ID)?.supersedesId).toBe(RULE_ID);
    expect(rows.find((r) => r.id === RULE_ID)?.validTo).toBe(NOW);
    expect(errLines).toContain(
      `note: superseded ${RULE_ID} ("Use npm for installs") — undo: mega memory reopen ${RULE_ID}`,
    );
  });

  it("weak supersession class downgrades to evidence note only", async () => {
    await seedStore();
    const code = await runMemoryCreate(
      makeInput({
        typeFlag: "decision",
        titleFlag: "Use pnpm",
        contentFlag: "use pnpm for installs",
        fileFlags: ["docs/install.md"],
      }),
    );
    expect(code).toBe(0);
    const rows = await readRows();
    const created = rows.find((r) => r.id === NEW_ID);
    expect(created?.supersedesId).toBeUndefined();
    expect(created?.evidence).toContain(`possible-supersedes:${DECISION_ID}`);
    expect(rows.find((r) => r.id === DECISION_ID)?.validTo).toBeUndefined();
    expect(errLines).toContain(
      `note: possibly supersedes ${DECISION_ID} ("Use npm") — link explicitly with --supersede ${DECISION_ID}`,
    );
  });

  it("duplicate short-circuits without writing", async () => {
    await seedStore();
    const code = await runMemoryCreate(
      makeInput({
        typeFlag: "decision",
        titleFlag: "Use npm",
        contentFlag: "use npm for installs",
      }),
    );
    expect(code).toBe(0);
    expect(lines).toEqual([DECISION_ID]);
    expect(await readRows()).toHaveLength(2);
    expect(errLines).toContain(`note: duplicate of ${DECISION_ID} — not written`);
  });

  it("--supersede links and closes explicitly", async () => {
    await seedStore();
    const code = await runMemoryCreate(
      makeInput({
        typeFlag: "decision",
        titleFlag: "Switch to bun",
        contentFlag: "use bun for installs",
        supersedeFlag: DECISION_ID,
      }),
    );
    expect(code).toBe(0);
    const rows = await readRows();
    expect(rows.find((r) => r.id === NEW_ID)?.supersedesId).toBe(DECISION_ID);
    expect(rows.find((r) => r.id === DECISION_ID)?.validTo).toBe(NOW);
    expect(errLines).toContain(
      `note: superseded ${DECISION_ID} ("Use npm") — undo: mega memory reopen ${DECISION_ID}`,
    );
  });

  it("--supersede with --no-auto-supersede is rejected", async () => {
    await seedStore();
    const code = await runMemoryCreate(
      makeInput({
        contentFlag: "use bun for installs",
        supersedeFlag: DECISION_ID,
        autoSupersedeFlag: false,
      }),
    );
    expect(code).toBe(1);
    expect(errLines).toContain("error: --supersede and --no-auto-supersede are mutually exclusive");
    expect(await readRows()).toHaveLength(2);
  });

  it("--json carries supersession and deduped fields", async () => {
    await seedStore();
    const code = await runMemoryCreate(
      makeInput({
        typeFlag: "project_rule",
        titleFlag: "Never use npm for installs",
        contentFlag: "use npm for installs",
        keywordFlags: ["never"],
        fileFlags: ["docs/install.md"],
        json: true,
      }),
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(lines[0] ?? "{}") as {
      id: string;
      supersession?: { supersededId: string; via: string; closed: boolean };
    };
    expect(parsed.id).toBe(NEW_ID);
    expect(parsed.supersession).toEqual({
      supersededId: RULE_ID,
      via: "contradiction",
      closed: true,
    });
  });

  it("citty parse path: --no-auto-supersede skips detection", async () => {
    await seedStore();
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    process.env["NODE_ENV"] = "test";
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    process.env["MEGA_TEST_MEMORY_ENTRY_ID"] = NEW_ID;
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    process.env["MEGA_TEST_NOW"] = NOW;
    await runCommand(memoryCreateCommand, {
      rawArgs: [
        "demo",
        "--scope",
        "project",
        "--type",
        "decision",
        "--content",
        "use pnpm for installs",
        "--file",
        "docs/install.md",
        "--store",
        store,
        "--no-auto-supersede",
      ],
    });
    expect(process.exitCode).toBe(0);
    const rows = await readRows();
    const created = rows.find((r) => r.id === NEW_ID);
    // Without the flag this fixture is the weak-supersession class and would
    // carry a possible-supersedes evidence string; its absence proves the
    // negation survived citty parsing.
    expect(created).toBeDefined();
    expect(created?.supersedesId).toBeUndefined();
    expect(created?.evidence).toBeUndefined();
  });

  it("citty parse path: --supersede plus --no-auto-supersede exits 1", async () => {
    await seedStore();
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    process.env["NODE_ENV"] = "test";
    await runCommand(memoryCreateCommand, {
      rawArgs: [
        "demo",
        "--scope",
        "project",
        "--content",
        "use bun for installs",
        "--supersede",
        DECISION_ID,
        "--store",
        store,
        "--no-auto-supersede",
      ],
    });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.flat()).toContain(
      "error: --supersede and --no-auto-supersede are mutually exclusive",
    );
    expect(await readRows()).toHaveLength(2);
  });
});
