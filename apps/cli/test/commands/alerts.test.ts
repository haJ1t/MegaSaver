// apps/cli/test/commands/alerts.test.ts
import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALERTS_UPSELL, runAlerts } from "../../src/commands/alerts.js";

type Payload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(privateKey: KeyObject, payload: Payload): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

const NOW_MS = Date.UTC(2026, 6, 15, 12, 0, 0);
const now = () => NOW_MS;
const DAY = 86_400_000;

let seq = 0;
function ev(daysAgo: number, rawBytes: number, label = "read") {
  const bytesSaved = Math.floor(rawBytes / 2);
  return {
    id: `e${seq++}`,
    sessionId: "s1",
    projectId: "p1",
    createdAt: new Date(NOW_MS - daysAgo * DAY).toISOString(),
    sourceKind: "file",
    label,
    rawBytes,
    returnedBytes: rawBytes - bytesSaved,
    bytesSaved,
    savingRatio: 0.5,
    summary: "",
    mode: "safe",
  } as never;
}

// 14 quiet days + a 2M-token spike today (same series the detector tests use).
function spikeEvents() {
  const events = [];
  for (let i = 1; i <= 14; i++) events.push(ev(i, 400_000));
  events.push(ev(0, 8_000_000));
  return events;
}

let root: string;
let keys: ReturnType<typeof generateKeyPairSync>;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-alerts-"));
  keys = generateKeyPairSync("ed25519");
  out = [];
  err = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function activatePro(): void {
  const key = signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "c1", iat: 0, exp: null });
  expect(activateLicense(root, key, { publicKey: keys.publicKey, now }).ok).toBe(true);
}

function run(
  over: {
    events?: unknown[];
    log?: string | null;
    budget?: { status: "absent" | "ok" | "corrupt"; budget: unknown };
    days?: string;
    json?: boolean;
  } = {},
) {
  const readAllEvents = vi.fn(async () => ({
    events: (over.events ?? []) as never[],
    eventsByProject: {},
  }));
  const readFirewallLog = vi.fn(() => over.log ?? null);
  const readStoredBudget = vi.fn(
    () => (over.budget ?? { status: "absent" as const, budget: null }) as never,
  );
  const code = runAlerts({
    storeRoot: root,
    now,
    publicKey: keys.publicKey,
    readAllEvents,
    readFirewallLog,
    readStoredBudget,
    ...(over.days !== undefined ? { days: over.days } : {}),
    ...(over.json !== undefined ? { json: over.json } : {}),
    stdout,
    stderr,
  });
  return { code, readAllEvents, readFirewallLog, readStoredBudget };
}

describe("runAlerts — gating", () => {
  it("free tier: upsell, exit 0, nothing read (plain, --json, --days variants)", async () => {
    for (const over of [{}, { json: true }, { days: "14" }] as const) {
      out = [];
      const { code, readAllEvents, readFirewallLog, readStoredBudget } = run(over);
      expect(await code).toBe(0);
      expect(out.join("\n")).toBe(ALERTS_UPSELL);
      expect(readAllEvents).not.toHaveBeenCalled();
      expect(readFirewallLog).not.toHaveBeenCalled();
      expect(readStoredBudget).not.toHaveBeenCalled();
    }
  });
});

describe("runAlerts — entitled", () => {
  beforeEach(() => activatePro());

  it("planted traffic spike → finding line + advice, exit 0", async () => {
    const { code } = run({ events: spikeEvents() });
    expect(await code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("[traffic]");
    expect(text).toContain("fix: context traffic spiked");
  });

  it("--json is the stable AlertsReport contract", async () => {
    const { code } = run({ events: spikeEvents(), json: true });
    expect(await code).toBe(0);
    const report = JSON.parse(out[0] as string);
    expect(report.status).toBe("alerts");
    expect(report.windowDays).toBe(30);
    expect(report.findings[0].axis).toBe("traffic");
  });

  it("insufficient history → honest line, exit 0", async () => {
    const { code } = run({ events: [ev(2, 400_000)] });
    expect(await code).toBe(0);
    expect(out.join("\n")).toContain("Not enough history yet");
  });

  it("quiet store with history → 'No anomalies' + skipped-axes note", async () => {
    // --days 14 matters: under the default 30-day window the baseline would be
    // zero-padded (16 empty days), median 0, floor threshold 50k — and a steady
    // 100k-token day would "spike". With a 14-day window the baseline is flat
    // 100k, fallback threshold max(4×100k, 50k) = 400k, today 100k is quiet.
    const events = [];
    for (let i = 1; i <= 14; i++) events.push(ev(i, 400_000));
    events.push(ev(0, 400_000));
    const { code } = run({ events, days: "14" });
    expect(await code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("No anomalies in the last 14 days.");
    expect(text).toContain("firewall"); // no ledger → skipped note
  });

  it("firewall ledger lines are parsed and drive the firewall axis", async () => {
    const lines = [];
    for (let i = 1; i <= 14; i++) {
      lines.push(
        JSON.stringify({
          at: new Date(NOW_MS - i * DAY).toISOString(),
          kind: "redacted",
          detector: "credit_card",
          count: 1,
        }),
      );
    }
    lines.push(
      JSON.stringify({
        at: new Date(NOW_MS).toISOString(),
        kind: "redacted",
        detector: "credit_card",
        count: 12,
      }),
    );
    lines.push("{corrupt tail"); // must not kill the report
    const { code } = run({ log: lines.join("\n"), days: "14" });
    expect(await code).toBe(0);
    expect(out.join("\n")).toContain("[firewall]");
  });

  it("stored budget behind pace → budget finding", async () => {
    const events = [];
    for (let i = 1; i <= 14; i++) events.push(ev(i, 8_000_000)); // 1M saved tokens/day
    const { code } = run({
      events,
      budget: {
        status: "ok",
        budget: { version: 1, period: "month", kind: "tokens", amount: 100_000_000 },
      },
    });
    expect(await code).toBe(0);
    expect(out.join("\n")).toContain("[budget]");
  });

  it("corrupt budget.json → stderr note, budget axis skipped, exit 0", async () => {
    const { code } = run({
      events: spikeEvents(),
      budget: { status: "corrupt", budget: null },
    });
    expect(await code).toBe(0);
    expect(err.join("\n")).toContain("corrupt");
    expect(out.join("\n")).not.toContain("[budget]");
  });

  it("bad --days → stderr + exit 1", async () => {
    for (const days of ["0", "-3", "abc", "3651", "1.5"]) {
      err = [];
      const { code } = run({ days });
      expect(await code).toBe(1);
      expect(err.join("\n")).toContain("Invalid --days");
    }
  });
});
