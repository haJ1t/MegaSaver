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
  over: {
    confidence: string;
    createdAt: string;
    updatedAt: string;
    expiresAt?: string;
    tier?: string;
  },
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
    ...(over.expiresAt !== undefined ? { expiresAt: over.expiresAt } : {}),
    ...(over.tier !== undefined ? { tier: over.tier } : {}),
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
    const summary = JSON.parse(out.join("")) as {
      archived: number;
      scanned: number;
      expired: number;
      rulesExpired: number;
    };
    expect(summary).toEqual({ archived: 1, scanned: 1, expired: 0, rulesExpired: 0 });
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

const RULE_ID = "55555555-5555-4555-8555-555555555555";

function ruleRow(id: string, expiresAt: string | null): string {
  return JSON.stringify({
    id,
    projectId: PROJECT_ID,
    title: "r",
    rule: "use pnpm",
    appliesTo: [],
    evidence: [],
    severity: "info",
    confidence: "medium",
    createdFrom: "manual",
    createdAt: OLD,
    updatedAt: OLD,
    ...(expiresAt !== null ? { expiresAt } : {}),
  });
}

async function seedRules(rules: string[]): Promise<void> {
  await mkdir(join(store, "project-rules"), { recursive: true });
  await writeFile(join(store, "project-rules", `${PROJECT_ID}.jsonl`), `${rules.join("\n")}\n`);
}

describe("runMemorySweep TTL enforcement", () => {
  it("archives a past-expiresAt entry (lossless) and reports expired=", async () => {
    await seed([
      memEntry(ID_RECENT_HIGH, {
        confidence: "high",
        createdAt: RECENT,
        updatedAt: RECENT,
        expiresAt: "2026-06-29T12:00:00.000Z", // before NOW
      }),
    ]);
    const code = await runMemorySweep(env());
    expect(code).toBe(0);
    const entries = await readEntries();
    expect(entries.find((e) => e.id === ID_RECENT_HIGH)?.tier).toBe("archival");
    expect(entries.length).toBe(1); // lossless — row still present
    expect(out.join("\n")).toContain("expired=1");
  });

  it("reports rulesExpired= without mutating the rule rows", async () => {
    await seed([
      memEntry(ID_RECENT_HIGH, { confidence: "high", createdAt: RECENT, updatedAt: RECENT }),
    ]);
    await seedRules([ruleRow(RULE_ID, "2026-06-01T00:00:00.000Z")]);
    const code = await runMemorySweep(env());
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("rulesExpired=1");
    const raw = await readFile(join(store, "project-rules", `${PROJECT_ID}.jsonl`), "utf8");
    expect(raw).toContain(RULE_ID); // read-exclusion only — never deleted
  });

  it("emits the new keys in --json", async () => {
    await seed([memEntry(ID_OLD_LOW, { confidence: "low", createdAt: OLD, updatedAt: OLD })]);
    const code = await runMemorySweep(env({ jsonFlag: true }));
    expect(code).toBe(0);
    const summary = JSON.parse(out.join("")) as Record<string, number>;
    expect(summary).toEqual({ archived: 1, scanned: 1, expired: 0, rulesExpired: 0 });
  });
});
