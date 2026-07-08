// apps/cli/test/commands/firewall.test.ts
import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateLicense } from "@megasaver/entitlement";
import { FIREWALL_ADVICE } from "@megasaver/pro-analytics";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIREWALL_UPSELL, runFirewall } from "../../src/commands/firewall.js";

type Payload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(privateKey: KeyObject, payload: Payload): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

const NOW_MS = Date.UTC(2026, 6, 8, 12, 0, 0);
const now = () => NOW_MS;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const fwLine = (over: Partial<Record<string, unknown>> = {}): string =>
  JSON.stringify({
    at: new Date(NOW_MS - HOUR).toISOString(),
    kind: "redacted",
    detector: "credit_card",
    count: 1,
    ...over,
  });

let root: string;
let keys: ReturnType<typeof generateKeyPairSync>;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-fw-"));
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
  const readFirewallLog = vi.fn(() => (over.log === undefined ? null : over.log));
  const code = runFirewall({
    storeRoot: root,
    now,
    publicKey: keys.publicKey,
    readFirewallLog,
    ...(over.days !== undefined ? { days: over.days } : {}),
    ...(over.json !== undefined ? { json: over.json } : {}),
    stdout,
    stderr,
  });
  return { code, readFirewallLog };
}

describe("runFirewall — gating", () => {
  it("free tier: upsell, exit 0, log never read (plain, --json, and --days variants)", async () => {
    for (const over of [{}, { json: true }, { days: "3" }] as const) {
      out = [];
      const { code, readFirewallLog } = run({ log: "", ...over });
      expect(await code).toBe(0);
      expect(out.join("\n")).toBe(FIREWALL_UPSELL);
      expect(readFirewallLog).not.toHaveBeenCalled();
    }
  });
});

describe("runFirewall — entitled", () => {
  beforeEach(() => activatePro());

  it("rejects invalid --days at the boundary", async () => {
    for (const bad of ["0", "-3", "x", "1.5", "10000000"]) {
      err = [];
      const { code } = run({ log: "", days: bad });
      expect(await code).toBe(1);
      expect(err.join("\n")).toContain("--days");
    }
  });

  it("--json always emits JSON, including no log and empty window", async () => {
    const noLog = run({ log: null, json: true });
    expect(await noLog.code).toBe(0);
    expect((JSON.parse(out.join("\n")) as { events: number }).events).toBe(0);
    out = [];
    const old = fwLine({ at: new Date(NOW_MS - 8 * DAY).toISOString() });
    const emptyWindow = run({ log: `${old}\n`, json: true });
    expect(await emptyWindow.code).toBe(0);
    expect((JSON.parse(out.join("\n")) as { events: number }).events).toBe(0);
  });

  it("--days widens the window (8-day-old event: excluded at default 7, included at 30)", async () => {
    const old = fwLine({ at: new Date(NOW_MS - 8 * DAY).toISOString() });
    const log = `${old}\n`;
    const def = run({ log, json: true });
    expect(await def.code).toBe(0);
    expect((JSON.parse(out.join("\n")) as { events: number }).events).toBe(0);
    out = [];
    const wide = run({ log, days: "30", json: true });
    expect(await wide.code).toBe(0);
    const r = JSON.parse(out.join("\n")) as { events: number; windowDays: number };
    expect(r.windowDays).toBe(30);
    expect(r.events).toBe(1);
  });

  it("renders the prose report: blocked reads, redactions, observed email, advice, footer", async () => {
    const lines = [
      fwLine({ kind: "blocked-read", detector: "secret-path", sourcePath: "/repo/.env" }),
      fwLine({ detector: "credit_card" }),
      fwLine({ detector: "github_token" }),
      fwLine({ kind: "observed", detector: "email", count: 1 }),
    ];
    const { code } = run({ log: `${lines.join("\n")}\n` });
    expect(await code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("Context firewall — last 7 days");
    expect(text).toContain("blocked reads");
    expect(text).toContain("/repo/.env");
    expect(text).toContain("credit_card");
    expect(text).toContain(FIREWALL_ADVICE.blocked);
    expect(text).toContain(FIREWALL_ADVICE.secrets);
    expect(text).toContain(FIREWALL_ADVICE.pii);
    expect(text).toContain("native agent reads bypass it");
  });

  it("corrupt lines are skipped instead of crashing", async () => {
    const log = `not json\n${fwLine()}\n`;
    const { code } = run({ log, json: true });
    expect(await code).toBe(0);
    expect((JSON.parse(out.join("\n")) as { events: number }).events).toBe(1);
  });

  it("empty window prose: friendly no-events note", async () => {
    const old = fwLine({ at: new Date(NOW_MS - 8 * DAY).toISOString() });
    const { code } = run({ log: `${old}\n` });
    expect(await code).toBe(0);
    expect(out.join("\n")).toContain("no firewall events recorded");
  });

  it("real-fs smoke: default reader finds the store ledger and renders the header", async () => {
    const { appendFirewallEvent } = await import("@megasaver/context-gate");
    const { defaultReadFirewallLog } = await import("../../src/commands/firewall.js");
    appendFirewallEvent(root, {
      at: new Date(NOW_MS - HOUR).toISOString(),
      kind: "redacted",
      detector: "credit_card",
      count: 1,
    });
    const code = await runFirewall({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readFirewallLog: defaultReadFirewallLog,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Context firewall — last");
  });
});

describe("firewall command registration", () => {
  it("is registered as a `mega firewall` subcommand", async () => {
    const { mainCommand } = await import("../../src/main.js");
    const sub = (mainCommand as { subCommands?: Record<string, unknown> }).subCommands;
    expect(sub).toBeDefined();
    expect(Object.keys(sub ?? {})).toContain("firewall");
  });
});
