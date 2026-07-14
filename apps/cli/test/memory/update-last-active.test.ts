import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMemoryUpdate } from "../../src/commands/memory/update.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ENTRY_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-07-01T00:00:00.000Z";
const NOW = "2026-07-13T00:00:00.000Z";

type StoredRow = { id: string; lastActiveAt?: string; updatedAt?: string; stale?: boolean };

describe("mega memory update — lastActiveAt touch", () => {
  let store: string;
  const lines: string[] = [];
  const errLines: string[] = [];

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-update-lastactive-"));
    lines.length = 0;
    errLines.length = 0;
  });

  afterEach(async () => {
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
    const row = {
      id: ENTRY_ID,
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      type: "decision",
      title: "Use npm",
      content: "use npm for installs",
      keywords: [],
      confidence: "high",
      source: "manual",
      stale: false,
      approval: "approved",
      createdAt: TS,
      updatedAt: TS,
    };
    await writeFile(join(store, "memory", `${PROJECT_ID}.jsonl`), `${JSON.stringify(row)}\n`);
  }

  async function readRow(): Promise<StoredRow | undefined> {
    const raw = await readFile(join(store, "memory", `${PROJECT_ID}.jsonl`), "utf8");
    return raw
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as StoredRow)[0];
  }

  function makeInput(
    over: Partial<Parameters<typeof runMemoryUpdate>[0]>,
  ): Parameters<typeof runMemoryUpdate>[0] {
    return {
      memoryEntryId: ENTRY_ID,
      typeFlag: undefined,
      titleFlag: undefined,
      contentFlag: undefined,
      confidenceFlag: undefined,
      sourceFlag: undefined,
      reasonFlag: undefined,
      goalFlag: undefined,
      keywordFlags: undefined,
      fileFlags: undefined,
      staleFlag: undefined,
      expiresFlag: undefined,
      storeFlag: store,
      jsonFlag: false,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
      home: process.env["HOME"] ?? "",
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      stdout: (line) => lines.push(line),
      stderr: (line) => errLines.push(line),
      now: () => NOW,
      ...over,
    };
  }

  it("title patch sets lastActiveAt", async () => {
    await seedStore();
    const code = await runMemoryUpdate(makeInput({ titleFlag: "Use npm always" }));
    expect(code).toBe(0);
    const row = await readRow();
    expect(row?.lastActiveAt).toBe(NOW);
    expect(row?.updatedAt).toBe(NOW);
  });

  it("content patch sets lastActiveAt", async () => {
    await seedStore();
    const code = await runMemoryUpdate(makeInput({ contentFlag: "use npm ci for installs" }));
    expect(code).toBe(0);
    expect((await readRow())?.lastActiveAt).toBe(NOW);
  });

  it("stale-only patch does NOT set lastActiveAt", async () => {
    await seedStore();
    const code = await runMemoryUpdate(makeInput({ staleFlag: true }));
    expect(code).toBe(0);
    const row = await readRow();
    expect(row?.stale).toBe(true);
    expect(row?.updatedAt).toBe(NOW);
    expect(row?.lastActiveAt).toBeUndefined();
  });
});
