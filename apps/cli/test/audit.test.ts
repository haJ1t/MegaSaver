import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AuditEvent,
  SAVINGS_FOOTNOTE,
  appendAuditEvent,
  computeSavingsHeadline,
  createJsonDirectoryCoreRegistry,
  initStore,
} from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAuditExport } from "../src/commands/audit/export.js";
import { runAuditReport } from "../src/commands/audit/report.js";
import { formatSavingsHeadlineLines } from "../src/commands/audit/shared.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-06-12T12:00:00.000Z";

let root: string;
const lines: string[] = [];
const stdout = (l: string) => lines.push(l);
const stderr = (l: string) => lines.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-audit-"));
  lines.length = 0;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function env() {
  return {
    storeFlag: root,
    cwd: root,
    home: root,
    xdgDataHome: undefined as string | undefined,
    platform: process.platform as NodeJS.Platform,
    localAppData: undefined as string | undefined,
  };
}

async function seedProject(): Promise<void> {
  await initStore(root);
  const registry = createJsonDirectoryCoreRegistry({ rootDir: root });
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: root,
    createdAt: TS,
    updatedAt: TS,
  } as never);
}

const packEvent = (): AuditEvent =>
  ({
    id: "evt-1",
    sessionId: SESSION_ID,
    projectId: PROJECT_ID,
    createdAt: TS,
    kind: "context_pack_built",
    filesConsidered: 5,
    filesIncluded: 2,
    filesExcluded: 3,
    blocksConsidered: 8,
    blocksIncluded: 3,
    blocksExcluded: 5,
    tokensBefore: 7000,
    tokensAfter: 2300,
  }) as AuditEvent;

describe("mega audit export", () => {
  it("rejects a non-json --format with exit 1", async () => {
    const code = await runAuditExport({
      projectName: "demo",
      formatFlag: "csv",
      windowFlag: undefined,
      sessionFlag: undefined,
      ...env(),
      stdout,
      stderr,
      now: () => "2026-06-12T12:00:00.000Z",
    });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("invalid format");
  });
});

describe("mega audit report", () => {
  it("renders the savings headline for a seeded pack event", async () => {
    await seedProject();
    appendAuditEvent({ store: { root }, event: packEvent() });
    const code = await runAuditReport({
      projectName: "demo",
      windowFlag: undefined,
      sessionFlag: undefined,
      ...env(),
      stdout,
      stderr,
      json: false,
      now: () => TS,
    });
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("would've been 7000 tokens, was 2300, 67% saved");
  });

  it("renders the $ savings headline and footnote for a seeded pack event", async () => {
    await seedProject();
    appendAuditEvent({ store: { root }, event: packEvent() });
    const code = await runAuditReport({
      projectName: "demo",
      windowFlag: undefined,
      sessionFlag: undefined,
      ...env(),
      stdout,
      stderr,
      json: false,
      now: () => TS,
    });
    expect(code).toBe(0);
    const text = lines.join("\n");
    // 4700 tokens saved -> $0.01 at the modeled input price; 4700/200000 = 0.0 sessions' worth.
    expect(text).toContain("Saved ≈4700 tokens ≈ $0.01 (est.)");
    expect(text).toContain("sessions' worth of context (200K each)");
    expect(text).toContain(SAVINGS_FOOTNOTE);
  });

  it("emits the SavingsHeadline object under --json", async () => {
    await seedProject();
    appendAuditEvent({ store: { root }, event: packEvent() });
    const code = await runAuditReport({
      projectName: "demo",
      windowFlag: undefined,
      sessionFlag: undefined,
      ...env(),
      stdout,
      stderr,
      json: true,
      now: () => TS,
    });
    expect(code).toBe(0);
    const payload = JSON.parse(lines.join("\n"));
    expect(payload.savingsHeadline).toEqual({
      tokensSaved: 4700,
      grossTokensSaved: 4700,
      tokensRefetched: 0,
      dollarsSaved: (4700 / 1_000_000) * 3.0,
      contextWindowsReclaimed: 4700 / 200_000,
      savingRatio: 67 / 100,
      isEstimate: true,
    });
  });

  it("shows an honest empty line when there are no savings", async () => {
    await seedProject();
    const code = await runAuditReport({
      projectName: "demo",
      windowFlag: undefined,
      sessionFlag: undefined,
      ...env(),
      stdout,
      stderr,
      json: false,
      now: () => TS,
    });
    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("No savings recorded in this window yet.");
    expect(text).not.toContain("$0.00 (est.)");
  });

  it("rejects a bad --window with exit 1", async () => {
    const code = await runAuditReport({
      projectName: "demo",
      windowFlag: "year",
      sessionFlag: undefined,
      ...env(),
      stdout,
      stderr,
      json: false,
      now: () => "2026-06-12T12:00:00.000Z",
    });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("invalid window");
  });

  it("maps a corrupt audit log to a clean store_corrupt message", async () => {
    await seedProject();
    const auditDir = join(root, "stats", PROJECT_ID);
    mkdirSync(auditDir, { recursive: true });
    writeFileSync(join(auditDir, `${SESSION_ID}.audit.jsonl`), "{not json}\n");
    const code = await runAuditReport({
      projectName: "demo",
      windowFlag: undefined,
      sessionFlag: undefined,
      ...env(),
      stdout,
      stderr,
      json: false,
      now: () => TS,
    });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("store_corrupt");
    expect(lines.join("\n")).not.toContain("unexpected failure");
  });
});

describe("formatSavingsHeadlineLines — net-first contract (S4-1)", () => {
  // bytes 40000 gross / 28000 net -> 10000 gross tokens, 7000 net, 3000 re-fetched.
  const refetchedHeadline = () =>
    computeSavingsHeadline({
      bytesSavedTotal: 40_000,
      sessionsCount: 1,
      savingRatio: 0.5,
      deltaBytesTotal: 28_000,
    });

  it("headlines the net and shows the gross − re-fetched breakdown", () => {
    const out = formatSavingsHeadlineLines(refetchedHeadline());
    expect(out[0]).toContain("Saved ≈7000 tokens net");
    expect(out[0]).toContain("≈10000 saved − 3000 re-fetched");
  });

  it("keeps the plain wording when nothing was re-fetched", () => {
    const out = formatSavingsHeadlineLines(
      computeSavingsHeadline({ bytesSavedTotal: 40_000, sessionsCount: 1, savingRatio: 0.5 }),
    );
    expect(out[0]).toContain("Saved ≈10000 tokens ≈");
    expect(out[0]).not.toContain("re-fetched");
  });

  it("reports a fully re-fetched window as zero net, not 'no savings'", () => {
    const out = formatSavingsHeadlineLines(
      computeSavingsHeadline({
        bytesSavedTotal: 4_000,
        sessionsCount: 1,
        savingRatio: 0.5,
        deltaBytesTotal: -4_000,
      }),
    );
    expect(out.join("\n")).not.toContain("No savings recorded");
    expect(out[0]).toContain("Saved ≈0 tokens net");
    expect(out[0]).toContain("≈1000 saved − 1000 re-fetched");
  });
});
