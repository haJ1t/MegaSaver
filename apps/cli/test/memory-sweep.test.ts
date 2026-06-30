import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMemorySweep } from "../src/commands/memory/sweep.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ID_OLD_LOW = "22222222-2222-4222-8222-222222222222";
const ID_RECENT_HIGH = "33333333-3333-4333-8333-333333333333";
const OLD = "2026-01-01T00:00:00.000Z";
const RECENT = "2026-06-29T00:00:00.000Z";
const NOW = "2026-06-30T00:00:00.000Z";

function memEntry(
  id: string,
  over: { confidence: string; createdAt: string; updatedAt: string },
): string {
  return JSON.stringify({
    id,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: id,
    content: id,
    keywords: [],
    confidence: over.confidence,
    source: "manual",
    approval: "approved",
    stale: false,
    createdAt: over.createdAt,
    updatedAt: over.updatedAt,
  });
}

let store: string;
let out: string[];
let err: string[];

function env(over: Record<string, unknown> = {}) {
  return {
    projectName: "demo",
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

async function seed(entries: string[]): Promise<void> {
  await mkdir(join(store, "memory"), { recursive: true });
  await writeFile(
    join(store, "projects.json"),
    JSON.stringify([
      { id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: OLD, updatedAt: OLD },
    ]),
  );
  await writeFile(join(store, "sessions.json"), "[]");
  await writeFile(join(store, "memory", `${PROJECT_ID}.jsonl`), `${entries.join("\n")}\n`);
}

type StoredRow = { id: string; tier?: string };

async function readEntries(): Promise<StoredRow[]> {
  const raw = await readFile(join(store, "memory", `${PROJECT_ID}.jsonl`), "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as StoredRow);
}

beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "mega-cli-mem-sweep-"));
  out = [];
  err = [];
});

afterEach(async () => {
  await rm(store, { recursive: true, force: true });
});

describe("runMemorySweep", () => {
  it("archives an old low-confidence memory and leaves a recent high one (lossless)", async () => {
    await seed([
      memEntry(ID_OLD_LOW, { confidence: "low", createdAt: OLD, updatedAt: OLD }),
      memEntry(ID_RECENT_HIGH, { confidence: "high", createdAt: RECENT, updatedAt: RECENT }),
    ]);
    const code = await runMemorySweep(env());
    expect(code).toBe(0);

    const entries = await readEntries();
    const oldLow = entries.find((e) => e.id === ID_OLD_LOW);
    const recentHigh = entries.find((e) => e.id === ID_RECENT_HIGH);
    expect(oldLow?.tier).toBe("archival");
    expect(recentHigh?.tier).toBeUndefined(); // untouched
    // lossless: both rows still present
    expect(entries.length).toBe(2);
    expect(out.join("\n")).toContain("archived=1");
    expect(out.join("\n")).toContain("scanned=2");
  });

  it("emits a JSON summary with --json", async () => {
    await seed([memEntry(ID_OLD_LOW, { confidence: "low", createdAt: OLD, updatedAt: OLD })]);
    const code = await runMemorySweep(env({ jsonFlag: true }));
    expect(code).toBe(0);
    const summary = JSON.parse(out.join("")) as { archived: number; scanned: number };
    expect(summary).toEqual({ archived: 1, scanned: 1 });
  });

  it("is idempotent — a second sweep archives nothing", async () => {
    await seed([memEntry(ID_OLD_LOW, { confidence: "low", createdAt: OLD, updatedAt: OLD })]);
    await runMemorySweep(env());
    out = [];
    const code = await runMemorySweep(env());
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("archived=0");
  });

  it("returns exit 1 for an unknown project", async () => {
    await seed([memEntry(ID_OLD_LOW, { confidence: "low", createdAt: OLD, updatedAt: OLD })]);
    const code = await runMemorySweep(env({ projectName: "nope" }));
    expect(code).toBe(1);
    expect(err.join("\n").length).toBeGreaterThan(0);
  });
});
