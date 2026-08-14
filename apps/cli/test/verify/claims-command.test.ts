import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type TokenSaverEvent,
  appendEvent,
  createJsonDirectoryCoreRegistry,
  initStore,
} from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runVerifyClaims } from "../../src/commands/verify/claims.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-08-06T11:50:00.000Z";
const NOW = "2026-08-06T12:00:00.000Z";

let root: string;
const out: string[] = [];
const err: string[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-verify-"));
  out.length = 0;
  err.length = 0;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function seedSession(): Promise<void> {
  await initStore(root);
  const registry = createJsonDirectoryCoreRegistry({ rootDir: root });
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: root,
    createdAt: TS,
    updatedAt: TS,
  } as never);
  registry.createSession({
    id: SESSION_ID,
    projectId: PROJECT_ID,
    agentId: "claude-code",
    riskLevel: "medium",
    title: "demo session",
    startedAt: TS,
    endedAt: null,
  } as never);
}

function seedReceipt(overrides: Partial<TokenSaverEvent>): void {
  appendEvent({
    store: { root },
    event: {
      id: "evt-1",
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      createdAt: TS,
      sourceKind: "command",
      label: "grep error src",
      rawBytes: 2000,
      returnedBytes: 500,
      bytesSaved: 1500,
      savingRatio: 0.75,
      summary: "3 kept",
      childExitCode: 0,
      ...overrides,
    } as TokenSaverEvent,
    secretsRedacted: 0,
    chunksStored: 1,
  });
}

function baseInput() {
  return {
    sessionFlag: SESSION_ID,
    fileFlag: undefined,
    windowFlag: undefined,
    strict: false,
    json: false,
    storeFlag: root,
    cwd: root,
    home: root,
    xdgDataHome: undefined,
    platform: process.platform as NodeJS.Platform,
    localAppData: undefined,
    stdinIsTty: false,
    readStdin: async () => "All tests pass and the build is green.",
    now: () => NOW,
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
  };
}

describe("mega verify claims", () => {
  it("reports VERIFIED when a clean in-window receipt exists", async () => {
    await seedSession();
    seedReceipt({});
    const code = await runVerifyClaims(baseInput());
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("VERIFIED");
    expect(out.join("\n")).toContain("grep error src");
  });

  it("reports NO-RECEIPT and fails --strict when the store is empty", async () => {
    await seedSession();
    const code = await runVerifyClaims({ ...baseInput(), strict: true });
    expect(code).toBe(1);
    expect(out.join("\n")).toContain("NO-RECEIPT");
  });

  it("highlights an exit mismatch", async () => {
    await seedSession();
    seedReceipt({ childExitCode: 2 });
    const code = await runVerifyClaims(baseInput());
    expect(code).toBe(0); // report-only without --strict
    expect(out.join("\n")).toContain("EXIT-MISMATCH");
  });

  it("--json emits one JSON document with the closed verdict union", async () => {
    await seedSession();
    seedReceipt({});
    const code = await runVerifyClaims({ ...baseInput(), json: true });
    expect(code).toBe(0);
    const doc = JSON.parse(out.join("\n")) as {
      sessionId: string;
      windowMinutes: number;
      claims: { patternId: string; verdict: string }[];
      receiptsConsidered: unknown[];
    };
    expect(doc.sessionId).toBe(SESSION_ID);
    expect(doc.windowMinutes).toBe(30);
    expect(doc.claims.every((c) => c.verdict === "verified")).toBe(true);
    expect(doc.receiptsConsidered).toHaveLength(1);
  });

  it("detection-only without --session lists claims and no verdicts", async () => {
    const code = await runVerifyClaims({ ...baseInput(), sessionFlag: undefined, json: true });
    expect(code).toBe(0);
    const doc = JSON.parse(out.join("\n")) as { sessionId: null; claims: unknown[] };
    expect(doc.sessionId).toBeNull();
    expect(doc.claims.length).toBeGreaterThan(0);
  });

  it("failure paths: TTY with no --file, --strict without --session, bad --window", async () => {
    const noInput = await runVerifyClaims({ ...baseInput(), stdinIsTty: true });
    expect(noInput).toBe(1);
    expect(err.join("\n")).toContain("claims_input_required");
    expect(out).toHaveLength(0);

    err.length = 0;
    const strictNoSession = await runVerifyClaims({
      ...baseInput(),
      sessionFlag: undefined,
      strict: true,
    });
    expect(strictNoSession).toBe(1);
    expect(err.join("\n")).toContain("--strict requires --session");

    err.length = 0;
    const badWindow = await runVerifyClaims({ ...baseInput(), windowFlag: "0" });
    expect(badWindow).toBe(1);
    expect(err.join("\n")).toContain("invalid window");
  });

  it("unknown session id exits 1 on stderr only", async () => {
    await seedSession();
    const code = await runVerifyClaims({
      ...baseInput(),
      sessionFlag: "99999999-9999-4999-8999-999999999999",
    });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("not found");
    expect(out).toHaveLength(0);
  });
});
