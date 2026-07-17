import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMemoryApprove } from "../../src/commands/memory/approve.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const CANDIDATE_ID = "33333333-3333-4333-8333-333333333333";
const TS = "2026-07-01T00:00:00.000Z";
const ACTIVE = "2026-07-03T00:00:00.000Z";
const NOW = "2026-07-14T00:00:00.000Z";
const LATER = "2026-07-15T00:00:00.000Z";

type StoredRow = {
  id: string;
  approval?: string;
  updatedAt?: string;
  validTo?: string | null;
  lastActiveAt?: string;
};

describe("mega memory approve — suggested revert (digest undo path)", () => {
  let store: string;
  const lines: string[] = [];
  const errLines: string[] = [];

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-approve-suggested-"));
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
    const base = {
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      type: "decision",
      keywords: [],
      confidence: "high",
      source: "agent",
      stale: false,
      createdAt: TS,
      updatedAt: TS,
      lastActiveAt: ACTIVE,
    };
    const rows = [
      {
        ...base,
        id: TARGET_ID,
        title: "Use npm for installs",
        content: "use npm for installs",
        approval: "approved",
      },
      {
        ...base,
        id: CANDIDATE_ID,
        title: "Use pnpm for installs",
        content: "use pnpm for installs",
        approval: "approved",
        supersedesId: TARGET_ID,
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
    over: Partial<Parameters<typeof runMemoryApprove>[0]>,
  ): Parameters<typeof runMemoryApprove>[0] {
    return {
      memoryEntryId: CANDIDATE_ID,
      approval: "suggested",
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

  it("flips an approved row back to suggested", async () => {
    await seedStore();
    const code = await runMemoryApprove(makeInput({}));
    expect(code).toBe(0);
    const row = (await readRows()).find((r) => r.id === CANDIDATE_ID);
    expect(row?.approval).toBe("suggested");
    expect(row?.updatedAt).toBe(NOW);
    // The flip patches approval + updatedAt and NOTHING else: a validTo stamped
    // here would make the row approved-but-closed on redo (silently absent from
    // default recall), and lastActiveAt must survive or the undo re-keys decay.
    expect(row?.validTo).toBeUndefined();
    expect(row?.lastActiveAt).toBe(ACTIVE);
    expect(lines).toContain(CANDIDATE_ID);
  });

  it("does NOT run supersession on the suggested path", async () => {
    await seedStore();
    const code = await runMemoryApprove(makeInput({}));
    expect(code).toBe(0);
    const target = (await readRows()).find((r) => r.id === TARGET_ID);
    // applySupersession fires only on the approved flip, never on the
    // suggested revert: the declared target must stay open, no note printed.
    expect(target?.validTo).toBeUndefined();
    expect(target?.approval).toBe("approved");
    expect(errLines).toEqual([]);
  });

  it("no-op guard: reverting an already-suggested row does not churn updatedAt", async () => {
    await seedStore();
    expect(await runMemoryApprove(makeInput({}))).toBe(0);
    lines.length = 0;
    expect(await runMemoryApprove(makeInput({ now: () => LATER }))).toBe(0);
    const row = (await readRows()).find((r) => r.id === CANDIDATE_ID);
    expect(row?.updatedAt).toBe(NOW);
    expect(lines).toContain(CANDIDATE_ID);
  });
});
