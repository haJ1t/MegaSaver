import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { DEFAULT_AUTOPILOT_POLICY, writeAutopilotPolicy } from "@megasaver/core";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUTOPILOT_UPSELL, runAutopilotRun } from "../../src/commands/brain/autopilot.js";
import { ensureStoreReady } from "../../src/store.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID = "44444444-4444-4444-8444-444444444444"; // exists; owns no session
const SESSION_A = "22222222-2222-4222-8222-222222222222"; // earlier session
const SESSION_B = "33333333-3333-4333-8333-333333333333"; // current session
const FA_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const FA_B1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const FA_B2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const FA_A2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const FA_B3 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
const TS = "2026-07-01T00:00:00.000Z";
const NOW = "2026-07-14T00:00:00.000Z";
const DISABLED_MESSAGE = "autopilot is off — enable with: mega brain autopilot on";

type LicensePayload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
  payload: LicensePayload,
): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

let store: string;
let out: string[];
let err: string[];
let proPublicKey: KeyObject | undefined;

beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "megasaver-autopilot-run-"));
  out = [];
  err = [];
  proPublicKey = undefined;
});

afterEach(async () => {
  await rm(store, { recursive: true, force: true });
});

function activatePro(): void {
  const keys = generateKeyPairSync("ed25519");
  const key = signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "t1", iat: 0, exp: null });
  activateLicense(store, key, { publicKey: keys.publicKey, now: () => Date.parse(NOW) });
  proPublicKey = keys.publicKey;
}

// Every byte of every file under the store. A refusal path must leave this
// identical: asserting one absent memory file would still pass if a guard let
// the run reach a different writer.
async function snapshotStore(): Promise<string> {
  const entries = await readdir(store, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  const parts: string[] = [];
  for (const file of files) {
    parts.push(`${relative(store, file)}\n${await readFile(file, "utf8")}`);
  }
  return parts.join("\n---\n");
}

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

async function seed(failures: string[]): Promise<void> {
  await mkdir(join(store, "memory"), { recursive: true });
  await mkdir(join(store, "failed-attempts"), { recursive: true });
  await writeFile(
    join(store, "projects.json"),
    JSON.stringify([
      { id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: TS, updatedAt: TS },
      { id: OTHER_PROJECT_ID, name: "elsewhere", rootPath: "/tmp", createdAt: TS, updatedAt: TS },
    ]),
  );
  await writeFile(
    join(store, "sessions.json"),
    JSON.stringify([
      {
        id: SESSION_A,
        projectId: PROJECT_ID,
        agentId: "claude-code",
        riskLevel: "medium",
        title: "earlier session",
        startedAt: TS,
        endedAt: TS,
      },
      {
        id: SESSION_B,
        projectId: PROJECT_ID,
        agentId: "claude-code",
        riskLevel: "medium",
        title: "current session",
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

// The same failure in session A and session B (cross-session recurrence —
// the dampener's qualifying signal, scores high) plus a one-off failure in
// session B (stays suggested).
function seedRecurringPlusOneOff(): Promise<void> {
  return seed([
    failure(FA_A, SESSION_A, {
      failedStep: "run auth tests",
      errorOutput: "AssertionError: expected 200 to be 401",
    }),
    failure(FA_B1, SESSION_B, {
      failedStep: "run auth tests",
      errorOutput: "AssertionError: expected 200 to be 401",
    }),
    failure(FA_B2, SESSION_B, {
      failedStep: "bundle the cli",
      errorOutput: "ENOENT: missing dist/cli.js",
    }),
  ]);
}

// Two DISTINCT cross-session recurrences — both qualify, so a cap below the
// qualifying count has something to bite on.
function seedTwoRecurring(): Promise<void> {
  return seed([
    failure(FA_A, SESSION_A, {
      failedStep: "run auth tests",
      errorOutput: "AssertionError: expected 200 to be 401",
    }),
    failure(FA_A2, SESSION_A, {
      failedStep: "run billing tests",
      errorOutput: "AssertionError: expected 500 to be 200",
    }),
    failure(FA_B1, SESSION_B, {
      failedStep: "run auth tests",
      errorOutput: "AssertionError: expected 200 to be 401",
    }),
    failure(FA_B3, SESSION_B, {
      failedStep: "run billing tests",
      errorOutput: "AssertionError: expected 500 to be 200",
    }),
  ]);
}

type StoredMem = {
  id: string;
  type: string;
  approval: string;
  confidence: string;
  keywords: string[];
  evidence?: string[];
  validFrom?: string;
  lastActiveAt?: string;
};

async function readMemories(): Promise<StoredMem[]> {
  const raw = await readFile(join(store, "memory", `${PROJECT_ID}.jsonl`), "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as StoredMem);
}

function runInput(over: Partial<Parameters<typeof runAutopilotRun>[0]> = {}) {
  let n = 0;
  return {
    storeRoot: store,
    sessionId: SESSION_B,
    projectName: undefined,
    dryRunFlag: false,
    jsonFlag: false,
    now: () => Date.parse(NOW),
    newId: () => `55555555-5555-4555-8555-${String(++n).padStart(12, "0")}`,
    ensureStore: () => ensureStoreReady(store),
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
    ...(proPublicKey === undefined ? {} : { publicKey: proPublicKey }),
    ...over,
  };
}

describe("mega brain autopilot run", () => {
  // Also the gate-ORDER probe: the default policy is disabled, so an
  // entitlement check running second would refuse with exit 1 instead.
  it("free tier: prints the upsell, exit 0, zero writes", async () => {
    await seedRecurringPlusOneOff();
    const before = await snapshotStore();
    const code = await runAutopilotRun(runInput());
    expect(code).toBe(0);
    expect(out).toContain(AUTOPILOT_UPSELL);
    expect(err).not.toContain(DISABLED_MESSAGE);
    expect(await snapshotStore()).toBe(before);
  });

  it("entitled but disabled: refuses on stderr, exit 1, zero writes", async () => {
    await seedRecurringPlusOneOff();
    activatePro();
    const before = await snapshotStore();
    const code = await runAutopilotRun(runInput());
    expect(code).toBe(1);
    expect(err).toContain(DISABLED_MESSAGE);
    expect(await snapshotStore()).toBe(before);
  });

  it("entitled + enabled: auto-approves the recurring failure, stages the rest", async () => {
    await seedRecurringPlusOneOff();
    activatePro();
    writeAutopilotPolicy(store, { ...DEFAULT_AUTOPILOT_POLICY, enabled: true });
    const code = await runAutopilotRun(runInput());
    expect(code).toBe(0);

    const mems = await readMemories();
    expect(mems).toHaveLength(2);
    const approved = mems.find((m) => m.approval === "approved");
    const staged = mems.find((m) => m.approval === "suggested");
    expect(approved).toBeDefined();
    expect(staged).toBeDefined();
    expect(approved?.confidence).toBe("high");
    expect(approved?.evidence).toContain(`autopilot@1 rule=recurring-failure session=${SESSION_B}`);
    expect(approved?.validFrom).toBe(NOW);
    expect(approved?.lastActiveAt).toBe(NOW);
    expect(approved?.keywords[0]).toMatch(/^from-session:/);
    expect(staged?.keywords[0]).toMatch(/^from-session:/);
    expect(staged?.evidence ?? []).toEqual([]);
    expect(out.join("\n")).toContain(
      "auto-approved 1 · staged 1 · skipped 0 (already captured) · capped 0",
    );
  });

  it("honors maxAutoApprovesPerSession: the qualifying overflow stays suggested", async () => {
    await seedTwoRecurring();
    activatePro();
    writeAutopilotPolicy(store, {
      ...DEFAULT_AUTOPILOT_POLICY,
      enabled: true,
      maxAutoApprovesPerSession: 1,
    });
    const code = await runAutopilotRun(runInput());
    expect(code).toBe(0);

    const mems = await readMemories();
    expect(mems).toHaveLength(2);
    expect(mems.filter((m) => m.approval === "approved")).toHaveLength(1);
    expect(mems.filter((m) => m.approval === "suggested")).toHaveLength(1);
    expect(out.join("\n")).toContain(
      "auto-approved 1 · staged 1 · skipped 0 (already captured) · capped 1",
    );
    expect(out.join("\n")).toContain(
      "notice: 1 more qualified — raise --max-per-session or approve in digest",
    );
  });

  it("--dry-run is free, ignores enabled, prints the banner, writes nothing", async () => {
    await seedRecurringPlusOneOff();
    const before = await snapshotStore();
    const code = await runAutopilotRun(runInput({ dryRunFlag: true }));
    expect(code).toBe(0);
    expect(err).toContain("DRY RUN — nothing written");
    expect(out.join("\n")).toContain(
      "auto-approved 1 · staged 1 · skipped 0 (already captured) · capped 0",
    );
    expect(await snapshotStore()).toBe(before);
  });

  it("--json emits the RunAutopilotResult shape", async () => {
    await seedRecurringPlusOneOff();
    activatePro();
    writeAutopilotPolicy(store, { ...DEFAULT_AUTOPILOT_POLICY, enabled: true });
    const code = await runAutopilotRun(runInput({ jsonFlag: true }));
    expect(code).toBe(0);
    const result = JSON.parse(out.join("")) as {
      autoApproved: unknown[];
      staged: unknown[];
      skippedExisting: number;
      cappedOut: number;
    };
    expect(result.autoApproved).toHaveLength(1);
    expect(result.staged).toHaveLength(1);
    expect(result.skippedExisting).toBe(0);
    expect(result.cappedOut).toBe(0);
  });

  it("unknown session exits 1", async () => {
    await seedRecurringPlusOneOff();
    const code = await runAutopilotRun(
      runInput({ dryRunFlag: true, sessionId: "99999999-9999-4999-8999-999999999999" }),
    );
    expect(code).toBe(1);
    expect(err.join("\n").length).toBeGreaterThan(0);
  });

  it("unknown --project exits 1 and writes nothing", async () => {
    await seedRecurringPlusOneOff();
    const before = await snapshotStore();
    const code = await runAutopilotRun(runInput({ dryRunFlag: true, projectName: "other" }));
    expect(code).toBe(1);
    expect(await snapshotStore()).toBe(before);
  });

  // Entitled + enabled on purpose: the guard is the only thing standing between
  // a --project typo and approved rows landing in the session's real project
  // while the user believes they scoped the run elsewhere.
  it("--project naming a real but foreign project exits 1 and writes nothing", async () => {
    await seedRecurringPlusOneOff();
    activatePro();
    writeAutopilotPolicy(store, { ...DEFAULT_AUTOPILOT_POLICY, enabled: true });
    const before = await snapshotStore();
    const code = await runAutopilotRun(runInput({ projectName: "elsewhere" }));
    expect(code).toBe(1);
    expect(err.join("\n")).toContain(`session ${SESSION_B} does not belong to project "elsewhere"`);
    expect(await snapshotStore()).toBe(before);
  });
});
