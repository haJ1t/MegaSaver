import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMemoryApprove } from "../../src/commands/memory/approve.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const CANDIDATE_ID = "33333333-3333-4333-8333-333333333333";
const LONE_ID = "44444444-4444-4444-8444-444444444444";
const TS = "2026-07-01T00:00:00.000Z";
const NOW = "2026-07-13T00:00:00.000Z";

type StoredRow = { id: string; approval?: string; validTo?: string | null };

describe("mega memory approve — supersession close", () => {
  let store: string;
  const lines: string[] = [];
  const errLines: string[] = [];

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-approve-lineage-"));
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
        approval: "suggested",
        supersedesId: TARGET_ID,
      },
      {
        ...base,
        id: LONE_ID,
        title: "Cache node_modules in CI",
        content: "cache node_modules in ci",
        approval: "suggested",
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
    over: Partial<Parameters<typeof runMemoryApprove>[0]> & {
      approval: "approved" | "rejected";
    },
  ): Parameters<typeof runMemoryApprove>[0] {
    return {
      memoryEntryId: CANDIDATE_ID,
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

  it("approving a linked candidate closes the declared target and prints the note", async () => {
    await seedStore();
    const code = await runMemoryApprove(makeInput({ approval: "approved" }));
    expect(code).toBe(0);
    const rows = await readRows();
    expect(rows.find((r) => r.id === CANDIDATE_ID)?.approval).toBe("approved");
    expect(rows.find((r) => r.id === TARGET_ID)?.validTo).toBe(NOW);
    expect(errLines).toContain(
      `note: this approval closed ${TARGET_ID} ("Use npm for installs") — undo: mega memory reopen ${TARGET_ID}`,
    );
  });

  it("approving an unlinked entry closes nothing and prints no note", async () => {
    await seedStore();
    const code = await runMemoryApprove(
      makeInput({ approval: "approved", memoryEntryId: LONE_ID }),
    );
    expect(code).toBe(0);
    const rows = await readRows();
    expect(rows.find((r) => r.id === LONE_ID)?.approval).toBe("approved");
    expect(rows.find((r) => r.id === TARGET_ID)?.validTo).toBeUndefined();
    expect(errLines.some((l) => l.includes("this approval closed"))).toBe(false);
  });

  it("rejecting a linked candidate closes nothing", async () => {
    await seedStore();
    const code = await runMemoryApprove(makeInput({ approval: "rejected" }));
    expect(code).toBe(0);
    const rows = await readRows();
    expect(rows.find((r) => r.id === TARGET_ID)?.validTo).toBeUndefined();
    expect(errLines.some((l) => l.includes("this approval closed"))).toBe(false);
  });
});
