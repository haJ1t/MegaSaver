import { type KeyObject, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type TokenSaverEvent,
  appendCodeTruthEvent,
  appendGuardEvent,
  createJsonDirectoryCoreRegistry,
  initStore,
} from "@megasaver/core";
import { activateLicense } from "@megasaver/entitlement";
import { projectIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type SavingsEventReader,
  defaultCodeTruthTotalsReader,
  defaultGuardTotalsReader,
  runSavingsExport,
  runSavingsForecast,
  runSavingsHistory,
  runSavingsInsights,
} from "../../src/commands/savings/index.js";
import { readStoreEnv } from "../../src/store.js";

// Spy on the proprietary Pro compute while delegating to the real implementation.
// The entitled tests exercise real analytics; the gating tests assert these are
// NEVER invoked on the upsell path — so moving the lazy `await import(...)` (or
// the compute) above the entitlement gate would fail a test, not just slip by.
const proSpies = vi.hoisted(() => ({
  computeSavingsHistory: vi.fn(),
  computeSavingsByProject: vi.fn(),
  exportSavings: vi.fn(),
  computeWasteBreakdown: vi.fn(),
  computeWasteHeadline: vi.fn(),
  forecastSavings: vi.fn(),
  budgetPace: vi.fn(),
}));

vi.mock("@megasaver/pro-analytics", async (importActual) => {
  const actual = await importActual<typeof import("@megasaver/pro-analytics")>();
  proSpies.computeSavingsHistory.mockImplementation(actual.computeSavingsHistory);
  proSpies.computeSavingsByProject.mockImplementation(actual.computeSavingsByProject);
  proSpies.exportSavings.mockImplementation(actual.exportSavings);
  proSpies.computeWasteBreakdown.mockImplementation(actual.computeWasteBreakdown);
  proSpies.computeWasteHeadline.mockImplementation(actual.computeWasteHeadline);
  proSpies.forecastSavings.mockImplementation(actual.forecastSavings);
  proSpies.budgetPace.mockImplementation(actual.budgetPace);
  return {
    ...actual,
    computeSavingsHistory: proSpies.computeSavingsHistory,
    computeSavingsByProject: proSpies.computeSavingsByProject,
    exportSavings: proSpies.exportSavings,
    computeWasteBreakdown: proSpies.computeWasteBreakdown,
    computeWasteHeadline: proSpies.computeWasteHeadline,
    forecastSavings: proSpies.forecastSavings,
    budgetPace: proSpies.budgetPace,
  };
});

type Payload = { v: number; tier: string; id: string; iat: number; exp: number | null };

const b64url = (buf: Buffer): string => buf.toString("base64url");

function signTestLicense(privateKey: KeyObject, payload: Payload): string {
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  const sig = sign(null, payloadBytes, privateKey);
  return `msp_${b64url(payloadBytes)}.${b64url(sig)}`;
}

const NOW_MS = 1_700_000_000_000;
const now = () => NOW_MS;

function event(createdAt: string, bytesSaved: number, projectId = "proj-1"): TokenSaverEvent {
  return {
    id: `e-${createdAt}-${bytesSaved}`,
    sessionId: "sess-1" as TokenSaverEvent["sessionId"],
    projectId: projectId as TokenSaverEvent["projectId"],
    createdAt,
    sourceKind: "file",
    label: "read",
    rawBytes: bytesSaved * 2,
    returnedBytes: bytesSaved,
    bytesSaved,
    savingRatio: 0.5,
    summary: "s",
    mode: "balanced",
  };
}

const sampleEvents: TokenSaverEvent[] = [
  event("2026-01-01T02:00:00.000Z", 400),
  event("2026-01-01T20:00:00.000Z", 600),
  event("2026-01-02T05:00:00.000Z", 800, "proj-2"),
];

function stubReader(): SavingsEventReader {
  return () => ({
    events: sampleEvents,
    eventsByProject: {
      "proj-1": sampleEvents.filter((e) => e.projectId === "proj-1"),
      "proj-2": sampleEvents.filter((e) => e.projectId === "proj-2"),
    },
  });
}

let root: string;
let keys: ReturnType<typeof generateKeyPairSync>;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-savings-"));
  keys = generateKeyPairSync("ed25519");
  out = [];
  err = [];
  proSpies.computeSavingsHistory.mockClear();
  proSpies.computeSavingsByProject.mockClear();
  proSpies.exportSavings.mockClear();
  proSpies.computeWasteBreakdown.mockClear();
  proSpies.computeWasteHeadline.mockClear();
  proSpies.forecastSavings.mockClear();
  proSpies.budgetPace.mockClear();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function activatePro(): void {
  const key = signTestLicense(keys.privateKey, {
    v: 1,
    tier: "pro",
    id: "cust-1",
    iat: 0,
    exp: null,
  });
  const res = activateLicense(root, key, { publicKey: keys.publicKey, now });
  expect(res.ok).toBe(true);
}

describe("runSavingsHistory — gating", () => {
  it("with NO license: prints the upsell, exit 0, and reads NO events", async () => {
    const readAllEvents = vi.fn(stubReader());

    const code = await runSavingsHistory({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents,
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("Mega Saver Pro");
    expect(text).toContain("mega license activate");
    expect(text.toLowerCase()).toContain("learn more");
    // The gate ran FIRST — the Pro compute path was never entered: no events
    // read AND no pro-analytics compute invoked (guards the lazy import too).
    expect(readAllEvents).not.toHaveBeenCalled();
    expect(proSpies.computeSavingsHistory).not.toHaveBeenCalled();
    expect(proSpies.computeSavingsByProject).not.toHaveBeenCalled();
    expect(proSpies.exportSavings).not.toHaveBeenCalled();
  });

  it("with a valid Pro license: reads events and renders the day history table", async () => {
    activatePro();
    const readAllEvents = vi.fn(stubReader());

    const code = await runSavingsHistory({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents,
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(readAllEvents).toHaveBeenCalledTimes(1);
    const text = out.join("\n");
    expect(text).toContain("2026-01-01");
    expect(text).toContain("2026-01-02");
  });
});

describe("runSavingsHistory — render variants (entitled)", () => {
  beforeEach(() => activatePro());

  it("--json emits a JSON array of history points", async () => {
    const code = await runSavingsHistory({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: stubReader(),
      json: true,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("\n")) as Array<{ bucket: string }>;
    expect(parsed.map((p) => p.bucket)).toEqual(["2026-01-01", "2026-01-02"]);
  });

  it("--csv emits a CSV with the history header", async () => {
    const code = await runSavingsHistory({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: stubReader(),
      csv: true,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("bucket,tokensSaved,dollarsSaved,events");
  });

  it("--by project renders per-project rows sorted desc", async () => {
    const code = await runSavingsHistory({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: stubReader(),
      by: "project",
      json: true,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("\n")) as Array<{ project: string }>;
    // proj-1 has 1000 saved bytes, proj-2 has 800 → proj-1 first.
    expect(parsed[0]?.project).toBe("proj-1");
  });

  it("floors the table $ column via formatDollarsSaved (matches the free headline)", async () => {
    // 49_380_000 saved bytes → 12_345_000 tokens → raw $37.035, which toFixed(2)
    // would round UP to 37.04; the table must show the floored "$37.03" so it
    // agrees with `mega audit report` / the GUI strip.
    const bigDay: SavingsEventReader = () => ({
      events: [event("2026-03-01T00:00:00.000Z", 49_380_000)],
      eventsByProject: {},
    });
    const code = await runSavingsHistory({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: bigDay,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("$37.03");
    expect(text).not.toContain("37.035");
    expect(text).not.toContain("37.04");
  });

  it("keeps the raw lossless dollarsSaved number in JSON output", async () => {
    const bigDay: SavingsEventReader = () => ({
      events: [event("2026-03-01T00:00:00.000Z", 49_380_000)],
      eventsByProject: {},
    });
    const code = await runSavingsHistory({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: bigDay,
      json: true,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("\n")) as Array<{ dollarsSaved: number }>;
    // Lossless raw number (12_345_000 / 1e6 * 3), NOT the floored display string.
    expect(parsed[0]?.dollarsSaved).toBe((12_345_000 / 1_000_000) * 3);
    expect(parsed[0]?.dollarsSaved).toBeCloseTo(37.035, 10);
  });

  it("--out writes the rendered output to a file", async () => {
    const outFile = join(root, "history.csv");
    const code = await runSavingsHistory({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: stubReader(),
      csv: true,
      out: outFile,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(existsSync(outFile)).toBe(true);
    expect(readFileSync(outFile, "utf8")).toContain("bucket,tokensSaved,dollarsSaved,events");
  });
});

describe("runSavingsHistory — warm start line (measured)", () => {
  beforeEach(() => activatePro());

  it("appends a Warm Start line when warm-start events exist", async () => {
    const code = await runSavingsHistory({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: stubReader(),
      readWarmStartTotals: () => ({ sessions: 3, briefTokens: 2400 }),
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain(
      "Warm start: 3 sessions warmed, ~2400 brief tokens (measured)",
    );
  });

  it("omits the Warm Start line when there are no warm-start events", async () => {
    const code = await runSavingsHistory({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: stubReader(),
      readWarmStartTotals: () => ({ sessions: 0, briefTokens: 0 }),
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).not.toContain("Warm start:");
  });

  it("omits the Warm Start line when no reader is provided", async () => {
    const code = await runSavingsHistory({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: stubReader(),
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).not.toContain("Warm start:");
  });

  it("never adds the Warm Start line to --json output", async () => {
    const code = await runSavingsHistory({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: stubReader(),
      readWarmStartTotals: () => ({ sessions: 3, briefTokens: 2400 }),
      json: true,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).not.toContain("Warm start:");
  });

  it("never adds the Warm Start line to --csv output", async () => {
    const code = await runSavingsHistory({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: stubReader(),
      readWarmStartTotals: () => ({ sessions: 3, briefTokens: 2400 }),
      csv: true,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).not.toContain("Warm start:");
  });
});

describe("runSavingsHistory — retry-cost-avoided line (estimated)", () => {
  beforeEach(() => activatePro());

  it("appends the retry-cost-avoided line when heeded intercepts exist", async () => {
    const code = await runSavingsHistory({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: stubReader(),
      readGuardTotals: () => ({ heededIntercepts: 1, avoidedTokens: 4200, overridden: 0 }),
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Retry cost avoided (estimated): ~4200 tokens");
  });

  it("omits the line when there are zero heeded intercepts", async () => {
    const code = await runSavingsHistory({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: stubReader(),
      readGuardTotals: () => ({ heededIntercepts: 0, avoidedTokens: 0, overridden: 2 }),
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).not.toContain("Retry cost avoided");
  });

  it("omits the line when no reader is provided", async () => {
    const code = await runSavingsHistory({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: stubReader(),
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).not.toContain("Retry cost avoided");
  });

  it("never adds the line to --json output", async () => {
    const code = await runSavingsHistory({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: stubReader(),
      readGuardTotals: () => ({ heededIntercepts: 1, avoidedTokens: 4200, overridden: 0 }),
      json: true,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).not.toContain("Retry cost avoided");
  });

  it("never adds the line to --csv output", async () => {
    const code = await runSavingsHistory({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: stubReader(),
      readGuardTotals: () => ({ heededIntercepts: 1, avoidedTokens: 4200, overridden: 0 }),
      csv: true,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).not.toContain("Retry cost avoided");
  });
});

// Seeds a real guard ledger and drives the production reader — the heeded
// computation (recall excluded, outcome rows demote intercepts to overridden)
// is money-path logic the injected-stub tests above never exercise.
describe("defaultGuardTotalsReader — heeded computation", () => {
  it("counts warn/deny intercepts with no outcome as heeded; excludes recall + overridden", async () => {
    const projectId = projectIdSchema.parse("22222222-2222-4222-8222-222222222222");
    await initStore(root);
    createJsonDirectoryCoreRegistry({ rootDir: root }).createProject({
      id: projectId,
      name: "demo",
      rootPath: "/tmp/demo",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const heededId = randomUUID();
    const overriddenId = randomUUID();
    const base = {
      projectId,
      sessionId: "sess-1",
      matchedId: "m1",
      matchedKind: "failed-attempt" as const,
      normalizedCommand: null,
      tier: "t1" as const,
      estimated: true as const,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    appendGuardEvent(
      { root },
      { type: "intercept", id: heededId, action: "warn", avoidedTokens: 4200, ...base },
    );
    appendGuardEvent(
      { root },
      { type: "intercept", id: overriddenId, action: "deny", avoidedTokens: 1000, ...base },
    );
    appendGuardEvent(
      { root },
      { type: "intercept", id: randomUUID(), action: "recall", avoidedTokens: 999, ...base },
    );
    appendGuardEvent(
      { root },
      {
        type: "outcome",
        id: randomUUID(),
        projectId,
        sessionId: "sess-1",
        interceptId: overriddenId,
        outcome: "overridden",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    );

    const totals = await defaultGuardTotalsReader(readStoreEnv(root))();
    expect(totals).toEqual({ heededIntercepts: 1, avoidedTokens: 4200, overridden: 1 });
  });
});

describe("runSavingsExport — gating", () => {
  it("with NO license: prints the upsell, exit 0, reads NO events", async () => {
    const readAllEvents = vi.fn(stubReader());
    const code = await runSavingsExport({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents,
      format: "csv",
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Mega Saver Pro");
    expect(readAllEvents).not.toHaveBeenCalled();
    // No Pro compute on the upsell path — guards the lazy import + compute.
    expect(proSpies.computeSavingsHistory).not.toHaveBeenCalled();
    expect(proSpies.exportSavings).not.toHaveBeenCalled();
  });

  it("with a valid license: exports CSV", async () => {
    activatePro();
    const code = await runSavingsExport({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: stubReader(),
      format: "csv",
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("bucket,tokensSaved,dollarsSaved,events");
  });

  it("with a valid license and --out: writes JSON to the file", async () => {
    activatePro();
    const outFile = join(root, "export.json");
    const code = await runSavingsExport({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: stubReader(),
      format: "json",
      out: outFile,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(existsSync(outFile)).toBe(true);
    const parsed = JSON.parse(readFileSync(outFile, "utf8")) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
  });
});

function insightsEvent(
  sourceKind: TokenSaverEvent["sourceKind"],
  label: string,
  rawBytes: number,
  returnedBytes: number,
  bytesSaved: number,
  i: number,
): TokenSaverEvent {
  return {
    id: `ie-${i}`,
    sessionId: "sess-1" as TokenSaverEvent["sessionId"],
    projectId: "proj-1" as TokenSaverEvent["projectId"],
    createdAt: "2026-07-01T00:00:00.000Z",
    sourceKind,
    label,
    rawBytes,
    returnedBytes,
    bytesSaved,
    savingRatio: rawBytes === 0 ? 0 : bytesSaved / rawBytes,
    summary: "s",
    mode: "safe",
  };
}

// Two sources with distinct returnedBytes so the sort order is observable:
// command still sends 1800 returned bytes (biggest ongoing cost), file 100.
const insightsEvents: TokenSaverEvent[] = [
  insightsEvent("command", "test", 1000, 900, 100, 0),
  insightsEvent("command", "test", 1000, 900, 100, 1),
  insightsEvent("file", "read", 1000, 100, 900, 2),
];

function insightsReader(): SavingsEventReader {
  return () => ({
    events: insightsEvents,
    eventsByProject: { "proj-1": insightsEvents },
  });
}

describe("runSavingsInsights — gating", () => {
  it("with NO license: prints the upsell, exit 0, reads NO events, computes nothing", async () => {
    const readAllEvents = vi.fn(insightsReader());

    const code = await runSavingsInsights({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents,
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("Mega Saver Pro");
    expect(text).toContain("mega license activate");
    // The gate ran FIRST — no events read AND no pro-analytics compute invoked
    // (guards the lazy import too: the Pro compute never half-runs for a free user).
    expect(readAllEvents).not.toHaveBeenCalled();
    expect(proSpies.computeWasteBreakdown).not.toHaveBeenCalled();
    expect(proSpies.computeWasteHeadline).not.toHaveBeenCalled();
  });

  it("with a valid Pro license: reads events and renders the top source + table header", async () => {
    activatePro();
    const readAllEvents = vi.fn(insightsReader());

    const code = await runSavingsInsights({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents,
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(readAllEvents).toHaveBeenCalledTimes(1);
    const text = out.join("\n");
    // Biggest source by returnedBytes is "command"; the table header lists columns.
    expect(text).toContain("command");
    expect(text).toContain("key  events");
  });
});

describe("runSavingsInsights — render variants (entitled)", () => {
  beforeEach(() => activatePro());

  it("--json emits { headline, rows } with rows an array", async () => {
    const code = await runSavingsInsights({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: insightsReader(),
      json: true,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("\n")) as {
      headline: { topKey: string };
      rows: Array<{ key: string }>;
    };
    expect(Array.isArray(parsed.rows)).toBe(true);
    expect(parsed.headline.topKey).toBe("command");
    expect(parsed.rows.map((r) => r.key)).toEqual(["command", "file"]);
  });

  it("--csv emits a CSV with the insights header row from exportSavings", async () => {
    const code = await runSavingsInsights({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: insightsReader(),
      csv: true,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("key,events,rawBytes,returnedBytes,bytesSaved");
  });

  it("floors both CSV $ columns (dollarsReturned + dollarsSaved) like the table", async () => {
    // returnedBytes and bytesSaved both 49_380_000 → each $37.035 raw; the CSV
    // must floor BOTH to "$37.03" (matching the table), never leak the raw float.
    const bigReader: SavingsEventReader = () => ({
      events: [insightsEvent("command", "test", 98_760_000, 49_380_000, 49_380_000, 0)],
      eventsByProject: {},
    });
    const code = await runSavingsInsights({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: bigReader,
      csv: true,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("$37.03");
    expect(text).not.toContain("37.035");
  });

  it("--by label groups by label", async () => {
    const code = await runSavingsInsights({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: insightsReader(),
      by: "label",
      json: true,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("\n")) as { rows: Array<{ key: string }> };
    // "test" returned 1800 > "read" 100.
    expect(parsed.rows.map((r) => r.key)).toEqual(["test", "read"]);
  });

  it("floors the table $ columns via formatDollarsSaved", async () => {
    // 49_380_000 saved bytes → 12_345_000 tokens → raw $37.035; the table must
    // show the floored "$37.03", agreeing with `mega audit report` / the GUI strip.
    const bigReader: SavingsEventReader = () => ({
      events: [insightsEvent("command", "test", 98_760_000, 0, 49_380_000, 0)],
      eventsByProject: {},
    });
    const code = await runSavingsInsights({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: bigReader,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("$37.03");
    expect(text).not.toContain("37.035");
    expect(text).not.toContain("37.04");
  });

  it("--out writes the rendered output to a file", async () => {
    const outFile = join(root, "insights.txt");
    const code = await runSavingsInsights({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: insightsReader(),
      out: outFile,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(existsSync(outFile)).toBe(true);
    expect(readFileSync(outFile, "utf8")).toContain("command");
    expect(out.join("\n")).toContain(`Wrote savings insights to ${outFile}`);
  });

  it("no events → No savings recorded yet., exit 0", async () => {
    const emptyReader: SavingsEventReader = () => ({ events: [], eventsByProject: {} });
    const code = await runSavingsInsights({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: emptyReader,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("No savings recorded yet.");
  });
});

describe("runSavingsInsights — warm start line (measured)", () => {
  beforeEach(() => activatePro());

  it("appends a Warm Start line when warm-start events exist", async () => {
    const code = await runSavingsInsights({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: insightsReader(),
      readWarmStartTotals: () => ({ sessions: 3, briefTokens: 2400 }),
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain(
      "Warm start: 3 sessions warmed, ~2400 brief tokens (measured)",
    );
  });

  it("omits the Warm Start line when there are no warm-start events", async () => {
    const code = await runSavingsInsights({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: insightsReader(),
      readWarmStartTotals: () => ({ sessions: 0, briefTokens: 0 }),
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).not.toContain("Warm start:");
  });

  it("omits the Warm Start line when no reader is provided", async () => {
    const code = await runSavingsInsights({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: insightsReader(),
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).not.toContain("Warm start:");
  });

  it("never adds the Warm Start line to --json output", async () => {
    const code = await runSavingsInsights({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: insightsReader(),
      readWarmStartTotals: () => ({ sessions: 3, briefTokens: 2400 }),
      json: true,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).not.toContain("Warm start:");
  });

  it("never adds the Warm Start line to --csv output", async () => {
    const code = await runSavingsInsights({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: insightsReader(),
      readWarmStartTotals: () => ({ sessions: 3, briefTokens: 2400 }),
      csv: true,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).not.toContain("Warm start:");
  });
});

describe("runSavingsInsights — retry-cost-avoided line (estimated)", () => {
  beforeEach(() => activatePro());

  it("appends the retry-cost-avoided line when heeded intercepts exist", async () => {
    const code = await runSavingsInsights({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: insightsReader(),
      readGuardTotals: () => ({ heededIntercepts: 1, avoidedTokens: 4200, overridden: 0 }),
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Retry cost avoided (estimated): ~4200 tokens");
  });

  it("omits the line when there are zero heeded intercepts", async () => {
    const code = await runSavingsInsights({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: insightsReader(),
      readGuardTotals: () => ({ heededIntercepts: 0, avoidedTokens: 0, overridden: 2 }),
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).not.toContain("Retry cost avoided");
  });

  it("omits the line when no reader is provided", async () => {
    const code = await runSavingsInsights({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: insightsReader(),
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).not.toContain("Retry cost avoided");
  });

  it("never adds the line to --json output", async () => {
    const code = await runSavingsInsights({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: insightsReader(),
      readGuardTotals: () => ({ heededIntercepts: 1, avoidedTokens: 4200, overridden: 0 }),
      json: true,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).not.toContain("Retry cost avoided");
  });

  it("never adds the line to --csv output", async () => {
    const code = await runSavingsInsights({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: insightsReader(),
      readGuardTotals: () => ({ heededIntercepts: 1, avoidedTokens: 4200, overridden: 0 }),
      csv: true,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).not.toContain("Retry cost avoided");
  });
});

// NOW_MS is 2023-11-14T22:13:20Z, so these two in-period events fall in the
// current UTC month (Nov 2023) before `now`, yielding a non-zero projection.
const forecastEvents: TokenSaverEvent[] = [
  event("2023-11-05T00:00:00.000Z", 4_000_000),
  event("2023-11-10T00:00:00.000Z", 4_000_000),
];

function forecastReader(): SavingsEventReader {
  return () => ({
    events: forecastEvents,
    eventsByProject: { "proj-1": forecastEvents },
  });
}

describe("runSavingsForecast — gating", () => {
  it("with NO license: prints the upsell, exit 0, reads NO events, computes nothing", async () => {
    const readAllEvents = vi.fn(forecastReader());

    const code = await runSavingsForecast({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents,
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("Mega Saver Pro");
    expect(text).toContain("mega license activate");
    // The gate ran FIRST — no events read AND no pro-analytics compute invoked
    // (guards the lazy import too: the Pro compute never half-runs for a free user).
    expect(readAllEvents).not.toHaveBeenCalled();
    expect(proSpies.forecastSavings).not.toHaveBeenCalled();
    expect(proSpies.budgetPace).not.toHaveBeenCalled();
  });

  it("bad --goal is rejected BEFORE any compute (stderr + exit 1, nothing read)", async () => {
    activatePro();
    const readAllEvents = vi.fn(forecastReader());

    const code = await runSavingsForecast({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents,
      goal: "abc",
      stdout,
      stderr,
    });

    expect(code).toBe(1);
    expect(err.join("\n")).toContain("--goal");
    // The bad flag is caught at the boundary, before events are read or projected.
    expect(readAllEvents).not.toHaveBeenCalled();
    expect(proSpies.forecastSavings).not.toHaveBeenCalled();
    expect(proSpies.budgetPace).not.toHaveBeenCalled();
  });
});

describe("runSavingsForecast — render variants (entitled)", () => {
  beforeEach(() => activatePro());

  it("with a valid Pro license: prints a projected $ estimate labeled (est.)", async () => {
    const readAllEvents = vi.fn(forecastReader());

    const code = await runSavingsForecast({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents,
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(readAllEvents).toHaveBeenCalledTimes(1);
    expect(proSpies.forecastSavings).toHaveBeenCalledTimes(1);
    const text = out.join("\n");
    expect(text.toLowerCase()).toContain("on pace");
    expect(text).toContain("(est.)");
    expect(text).toContain("$");
  });

  it("--goal $10 shows a % pace figure and calls budgetPace once", async () => {
    const code = await runSavingsForecast({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: forecastReader(),
      goal: "$10",
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(proSpies.budgetPace).toHaveBeenCalledTimes(1);
    expect(out.join("\n")).toContain("%");
  });

  it("--json emits { forecast, pace } when a goal is set", async () => {
    const code = await runSavingsForecast({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: forecastReader(),
      goal: "$10",
      json: true,
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("\n")) as {
      forecast: { period: string; projectedEnd: { dollars: number } };
      pace: { pctOfGoalProjected: number };
    };
    expect(parsed.forecast.period).toBe("month");
    expect(parsed.pace.pctOfGoalProjected).toBeGreaterThan(0);
  });

  it("--json without a goal emits { forecast } and no pace", async () => {
    const code = await runSavingsForecast({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: forecastReader(),
      json: true,
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("\n")) as { forecast: unknown; pace?: unknown };
    expect(parsed.forecast).toBeDefined();
    expect(parsed.pace).toBeUndefined();
    expect(proSpies.budgetPace).not.toHaveBeenCalled();
  });

  it.each(["abc", "0", "-5"])("--goal %s → stderr error, exit 1, no render", async (bad) => {
    const code = await runSavingsForecast({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: forecastReader(),
      goal: bad,
      stdout,
      stderr,
    });

    expect(code).toBe(1);
    expect(err.join("\n")).toContain("--goal");
    expect(out.join("\n")).toBe("");
    expect(proSpies.forecastSavings).not.toHaveBeenCalled();
    expect(proSpies.budgetPace).not.toHaveBeenCalled();
  });

  it("no in-period events → 'No savings recorded this month yet.', exit 0", async () => {
    const staleReader: SavingsEventReader = () => ({
      events: [event("2022-11-05T00:00:00.000Z", 4_000_000)],
      eventsByProject: {},
    });
    const code = await runSavingsForecast({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: staleReader,
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("No savings recorded this month yet.");
  });
});

describe("runSavingsForecast — stored budget auto-load (1.13)", () => {
  const stored = {
    status: "ok" as const,
    budget: {
      version: 1 as const,
      period: "week" as const,
      kind: "dollars" as const,
      amount: 20,
    },
  };
  const absent = { status: "absent" as const, budget: null };

  // NOW_MS is Tue 2023-11-14T22:13:20Z; the current Monday-based week starts
  // Mon 2023-11-13. The suite's forecastEvents (Nov 5/10) fall BEFORE that
  // week — with the stored "week" period they'd yield savedSoFar 0 and the
  // early "No savings recorded" return, never the pace line. The stored-budget
  // tests therefore use a week-fresh event.
  const weekEvents: TokenSaverEvent[] = [event("2023-11-14T00:00:00.000Z", 4_000_000)];
  const weekReader: SavingsEventReader = () => ({
    events: weekEvents,
    eventsByProject: { "proj-1": weekEvents },
  });

  it("free tier: readStoredBudget is never invoked (gate first)", async () => {
    const readStoredBudget = vi.fn(() => stored);
    const code = await runSavingsForecast({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: vi.fn(forecastReader()),
      readStoredBudget,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Mega Saver Pro");
    expect(readStoredBudget).not.toHaveBeenCalled();
  });

  describe("entitled", () => {
    beforeEach(() => activatePro());

    it("no flags → stored budget supplies goal AND period, marker shown", async () => {
      const code = await runSavingsForecast({
        storeRoot: root,
        now,
        publicKey: keys.publicKey,
        readAllEvents: weekReader,
        readStoredBudget: () => stored,
        stdout,
        stderr,
      });
      expect(code).toBe(0);
      const text = out.join("\n");
      expect(text).toContain("this week"); // period came from the store
      expect(text).toContain("stored budget"); // marker replaces the word "goal"
      expect(proSpies.budgetPace).toHaveBeenCalledTimes(1);
    });

    it("explicit --goal wins over the stored budget", async () => {
      // period still auto-loads from the store ("week") → needs in-week savings
      const code = await runSavingsForecast({
        storeRoot: root,
        now,
        publicKey: keys.publicKey,
        readAllEvents: weekReader,
        readStoredBudget: () => stored,
        goal: "$50",
        stdout,
        stderr,
      });
      expect(code).toBe(0);
      const text = out.join("\n");
      expect(text).toContain("$50");
      expect(text).toContain("goal");
      expect(text).not.toContain("stored budget");
    });

    it("explicit --period wins over the stored period", async () => {
      const code = await runSavingsForecast({
        storeRoot: root,
        now,
        publicKey: keys.publicKey,
        readAllEvents: forecastReader(),
        readStoredBudget: () => stored,
        period: "month",
        stdout,
        stderr,
      });
      expect(code).toBe(0);
      expect(out.join("\n")).toContain("this month");
    });

    it("--json gains goalSource ('stored' vs 'flag') when a pace exists", async () => {
      const code = await runSavingsForecast({
        storeRoot: root,
        now,
        publicKey: keys.publicKey,
        readAllEvents: weekReader,
        readStoredBudget: () => stored,
        json: true,
        stdout,
        stderr,
      });
      expect(code).toBe(0);
      const parsed = JSON.parse(out.join("\n")) as { goalSource: string; pace: unknown };
      expect(parsed.goalSource).toBe("stored");
      expect(parsed.pace).toBeDefined();

      out.length = 0;
      await runSavingsForecast({
        storeRoot: root,
        now,
        publicKey: keys.publicKey,
        readAllEvents: forecastReader(),
        readStoredBudget: () => absent,
        goal: "$50",
        json: true,
        stdout,
        stderr,
      });
      expect((JSON.parse(out.join("\n")) as { goalSource: string }).goalSource).toBe("flag");
    });

    it("no flags + absent stored budget → plain forecast, unchanged behavior", async () => {
      const code = await runSavingsForecast({
        storeRoot: root,
        now,
        publicKey: keys.publicKey,
        readAllEvents: forecastReader(),
        readStoredBudget: () => absent,
        stdout,
        stderr,
      });
      expect(code).toBe(0);
      const text = out.join("\n");
      expect(text).toContain("this month");
      expect(text).not.toContain("% of your");
      expect(proSpies.budgetPace).not.toHaveBeenCalled();
    });

    it("corrupt stored budget → stderr note, forecast proceeds without a pace", async () => {
      const code = await runSavingsForecast({
        storeRoot: root,
        now,
        publicKey: keys.publicKey,
        readAllEvents: forecastReader(),
        readStoredBudget: () => ({ status: "corrupt" as const, budget: null }),
        stdout,
        stderr,
      });
      expect(code).toBe(0);
      expect(err.join("\n")).toContain("corrupt");
      expect(out.join("\n")).not.toContain("% of your");
    });
  });
});

describe("savings — stale-recall-avoided line (estimated, i6 §10)", () => {
  beforeEach(() => activatePro());

  it("history appends the stale-recall line when demotions exist", async () => {
    const code = await runSavingsHistory({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: stubReader(),
      readCodeTruthTotals: () => ({ demotions: 2, avoidedTokens: 300 }),
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Stale recall waste avoided (estimated): ~300 tokens");
    expect(out.join("\n")).toContain("across 2 demotions");
  });

  it("history omits the line when there are zero demotions", async () => {
    const code = await runSavingsHistory({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: stubReader(),
      readCodeTruthTotals: () => ({ demotions: 0, avoidedTokens: 0 }),
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).not.toContain("Stale recall waste avoided");
  });

  it("insights mirrors the line", async () => {
    const code = await runSavingsInsights({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: insightsReader(),
      readCodeTruthTotals: () => ({ demotions: 1, avoidedTokens: 120 }),
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Stale recall waste avoided (estimated): ~120 tokens");
  });

  it("never adds the line to --json output", async () => {
    const code = await runSavingsHistory({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: stubReader(),
      readCodeTruthTotals: () => ({ demotions: 2, avoidedTokens: 300 }),
      json: true,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).not.toContain("Stale recall waste avoided");
  });

  it("defaultCodeTruthTotalsReader sums real ledger events", async () => {
    const projectId = projectIdSchema.parse("22222222-2222-4222-8222-222222222222");
    await initStore(root);
    createJsonDirectoryCoreRegistry({ rootDir: root }).createProject({
      id: projectId,
      name: "demo",
      rootPath: "/tmp/demo",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    appendCodeTruthEvent(
      { root },
      {
        type: "stale-recall-avoided",
        id: randomUUID(),
        projectId,
        sessionId: "sess-1",
        memoryId: "m1",
        avoidedTokens: 120,
        estimated: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    );
    appendCodeTruthEvent(
      { root },
      {
        type: "stale-recall-avoided",
        id: randomUUID(),
        projectId,
        sessionId: "sess-1",
        memoryId: "m2",
        avoidedTokens: 30,
        estimated: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    );
    const totals = await defaultCodeTruthTotalsReader(readStoreEnv(root))();
    expect(totals).toEqual({ demotions: 2, avoidedTokens: 150 });
  });
});
