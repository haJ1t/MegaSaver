// apps/cli/test/commands/cache.test.ts
import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCache } from "../../src/commands/cache.js";

type Payload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(privateKey: KeyObject, payload: Payload): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

const NOW_MS = Date.UTC(2026, 6, 8, 12, 0, 0);
const now = () => NOW_MS;
const HOUR = 3_600_000;

function usageLine(over: Partial<Record<string, unknown>> & { atMs: number }): string {
  const { atMs, ...rest } = over;
  return JSON.stringify({
    id: "e1",
    ts: new Date(atMs).toISOString(),
    model: "claude-sonnet-5",
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    messageCount: 1,
    stream: false,
    ...rest,
  });
}

let root: string;
let keys: ReturnType<typeof generateKeyPairSync>;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-cache-"));
  keys = generateKeyPairSync("ed25519");
  out = [];
  err = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function activatePro(): void {
  const key = signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "c1", iat: 0, exp: null });
  expect(activateLicense(root, key, { publicKey: keys.publicKey, now }).ok).toBe(true);
}

function run(over: { log?: string | null; days?: string; json?: boolean } = {}) {
  const readUsageLog = vi.fn(() => (over.log === undefined ? null : over.log));
  const code = runCache({
    storeRoot: root,
    now,
    publicKey: keys.publicKey,
    readUsageLog,
    ...(over.days !== undefined ? { days: over.days } : {}),
    ...(over.json !== undefined ? { json: over.json } : {}),
    stdout,
    stderr,
  });
  return { code, readUsageLog };
}

describe("runCache — gating", () => {
  it("free tier: upsell, exit 0, log never read", async () => {
    const { code, readUsageLog } = run({ log: "" });
    expect(await code).toBe(0);
    expect(out.join("\n")).toContain("mega license activate");
    expect(readUsageLog).not.toHaveBeenCalled();
  });
});

describe("runCache — entitled", () => {
  beforeEach(() => activatePro());

  it("no usage log → friendly note, exit 0", async () => {
    const { code } = run({ log: null });
    expect(await code).toBe(0);
    expect(out.join("\n")).toContain("mega proxy");
  });

  it("empty window → same friendly note", async () => {
    const old = usageLine({ atMs: NOW_MS - 9 * 24 * HOUR });
    const { code } = run({ log: `${old}\n` });
    expect(await code).toBe(0);
    expect(out.join("\n")).toContain("mega proxy");
  });

  it("skips malformed lines instead of crashing", async () => {
    const good = usageLine({ atMs: NOW_MS - HOUR, inputTokens: 2_000 });
    const log = `not json\n${good}\n{"half": true}\n`;
    const { code } = run({ log });
    expect(await code).toBe(0);
    expect(out.join("\n")).toContain("Prompt-cache doctor");
    expect(out.join("\n")).toContain("calls 1");
  });

  it("rejects invalid --days at the boundary", async () => {
    // Includes an over-cap value (> 3650): unbounded days would push the window
    // start past the JS Date range and throw a RangeError in diagnoseCache.
    for (const bad of ["0", "-3", "x", "1.5", "10000000"]) {
      err = [];
      const { code } = run({ log: "", days: bad });
      expect(await code).toBe(1);
      expect(err.join("\n")).toContain("--days");
    }
  });

  it("--json always emits JSON, even with no usage log (contract for jq consumers)", async () => {
    const noLog = run({ log: null, json: true });
    expect(await noLog.code).toBe(0);
    expect((JSON.parse(out.join("\n")) as { calls: number }).calls).toBe(0);
    out = [];
    const old = usageLine({ atMs: NOW_MS - 9 * 24 * HOUR });
    const emptyWindow = run({ log: `${old}\n`, json: true });
    expect(await emptyWindow.code).toBe(0);
    expect((JSON.parse(out.join("\n")) as { calls: number }).calls).toBe(0);
  });

  it("--days widens the window (a 20-day-old miss: excluded at default 7, included at 30)", async () => {
    const DAY = 24 * HOUR;
    const lines = [
      usageLine({ atMs: NOW_MS - 20 * DAY, messageCount: 1, cacheCreationTokens: 5_000 }),
      usageLine({ atMs: NOW_MS - 20 * DAY + 60_000, messageCount: 3, cacheCreationTokens: 5_000 }),
    ];
    const log = `${lines.join("\n")}\n`;
    const def = run({ log, json: true });
    expect(await def.code).toBe(0);
    expect((JSON.parse(out.join("\n")) as { calls: number }).calls).toBe(0);
    out = [];
    const wide = run({ log, days: "30", json: true });
    expect(await wide.code).toBe(0);
    const r = JSON.parse(out.join("\n")) as { calls: number; windowDays: number };
    expect(r.windowDays).toBe(30);
    expect(r.calls).toBe(2);
  });

  it("renders the $ burned headline on reliable data (>=20 events, >=3 conversations)", async () => {
    const lines: string[] = [];
    // Conversation 1: 18 events, each turn after the first re-writes the cache
    // (unstable-prefix miss). 18 events / mc 1..18.
    lines.push(usageLine({ atMs: NOW_MS - 3 * HOUR, messageCount: 1, cacheCreationTokens: 5_000 }));
    for (let i = 1; i < 18; i++) {
      lines.push(
        usageLine({
          atMs: NOW_MS - 3 * HOUR + i * 60_000,
          messageCount: i + 1,
          cacheCreationTokens: 5_000,
        }),
      );
    }
    // Conversations 2 and 3: one event each (messageCount reset starts a new one).
    lines.push(usageLine({ atMs: NOW_MS - 2 * HOUR, messageCount: 1 }));
    lines.push(usageLine({ atMs: NOW_MS - 1 * HOUR, messageCount: 1 }));
    const { code } = run({ log: `${lines.join("\n")}\n` });
    expect(await code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("burned on cache misses");
    expect(text).toMatch(/\$\d+\.\d{2} burned/);
    expect(text).not.toContain("not enough data");
  });

  it("--json emits the raw report", async () => {
    const good = usageLine({ atMs: NOW_MS - HOUR });
    const { code } = run({ log: `${good}\n`, json: true });
    expect(await code).toBe(0);
    const report = JSON.parse(out.join("\n")) as { calls: number; windowDays: number };
    expect(report.calls).toBe(1);
    expect(report.windowDays).toBe(7);
  });

  it("healthy data renders the healthy line, no burn headline", async () => {
    const lines = [
      usageLine({ atMs: NOW_MS - 2 * HOUR, messageCount: 1, cacheCreationTokens: 8_000 }),
      usageLine({
        atMs: NOW_MS - 2 * HOUR + 60_000,
        messageCount: 3,
        cacheReadTokens: 8_000,
        cacheCreationTokens: 200,
      }),
    ];
    const { code } = run({ log: `${lines.join("\n")}\n` });
    expect(await code).toBe(0);
    expect(out.join("\n")).toContain("cache healthy");
    expect(out.join("\n")).not.toContain("burned on cache misses");
  });

  it("findings render tokens, dollars, and the fix line; thin data suppresses the headline", async () => {
    // One unstable-prefix miss: two calls, 5000 write then 5000 re-write.
    const lines = [
      usageLine({ atMs: NOW_MS - 2 * HOUR, messageCount: 1, cacheCreationTokens: 5_000 }),
      usageLine({
        atMs: NOW_MS - 2 * HOUR + 60_000,
        messageCount: 3,
        cacheCreationTokens: 5_000,
      }),
    ];
    const { code } = run({ log: `${lines.join("\n")}\n` });
    expect(await code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("unstable-prefix");
    expect(text).toContain("5000 tokens re-paid");
    expect(text).toContain("fix: keep the prompt prefix byte-stable");
    // 2 calls / 1 conversation → unreliable → headline suppressed, caveat shown.
    expect(text).not.toContain("burned on cache misses");
    expect(text).toContain("not enough data for a confident diagnosis");
  });

  it("real-fs smoke: default reader finds the store log and prices a known miss", async () => {
    const { defaultReadUsageLog } = await import("../../src/commands/cache.js");
    const dir = join(root, "proxy-usage");
    mkdirSync(dir, { recursive: true });
    const lines = [
      usageLine({ atMs: NOW_MS - 2 * HOUR, messageCount: 1, cacheCreationTokens: 10_000 }),
      usageLine({
        atMs: NOW_MS - 2 * HOUR + 60_000,
        messageCount: 3,
        cacheCreationTokens: 10_000,
      }),
    ];
    writeFileSync(join(dir, "usage.jsonl"), `${lines.join("\n")}\n`);
    const code = await runCache({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readUsageLog: defaultReadUsageLog,
      json: true,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    const report = JSON.parse(out.join("\n")) as {
      findings: Array<{ detector: string; burnedUsd: number }>;
    };
    expect(report.findings[0]?.detector).toBe("unstable-prefix");
    // 10000 re-paid × $3/MTok × 1.15
    expect(report.findings[0]?.burnedUsd).toBeCloseTo(0.0345, 6);
  });
});
