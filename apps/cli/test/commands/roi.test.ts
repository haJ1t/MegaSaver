import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TokenSaverEvent } from "@megasaver/core";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runRoi } from "../../src/commands/roi.js";
import type { SavingsEventReader } from "../../src/commands/savings/index.js";

// Spy on the proprietary Pro compute while delegating to the real implementation.
// Gating tests assert it is NEVER invoked on the upsell path — so moving the lazy
// `await import(...)` (or the compute) above the entitlement gate fails a test.
const proSpies = vi.hoisted(() => ({ computeRoi: vi.fn() }));

vi.mock("@megasaver/pro-analytics", async (importActual) => {
  const actual = await importActual<typeof import("@megasaver/pro-analytics")>();
  proSpies.computeRoi.mockImplementation(actual.computeRoi);
  return { ...actual, computeRoi: proSpies.computeRoi };
});

type Payload = { v: number; tier: string; id: string; iat: number; exp: number | null };

const b64url = (buf: Buffer): string => buf.toString("base64url");

function signTestLicense(privateKey: KeyObject, payload: Payload): string {
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  const sig = sign(null, payloadBytes, privateKey);
  return `msp_${b64url(payloadBytes)}.${b64url(sig)}`;
}

const NOW_MS = 1_700_000_000_000; // 2023-11-14T22:13:20Z — 30-day month, ~13.9 days elapsed
const now = () => NOW_MS;

function event(createdAt: string, bytesSaved: number): TokenSaverEvent {
  return {
    id: `e-${createdAt}-${bytesSaved}`,
    sessionId: "sess-1" as TokenSaverEvent["sessionId"],
    projectId: "proj-1" as TokenSaverEvent["projectId"],
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

// 8_000_000 bytes → 2_000_000 tokens → $6.00 saved this month.
// Default price 7.99 → roiSoFar ≈ 0.75 (NOT paid for itself yet).
// --price $5 → roiSoFar = 1.2 (paid for itself).
const roiEvents: TokenSaverEvent[] = [
  event("2023-11-05T00:00:00.000Z", 4_000_000),
  event("2023-11-10T00:00:00.000Z", 4_000_000),
];

function roiReader(): SavingsEventReader {
  return () => ({ events: roiEvents, eventsByProject: { "proj-1": roiEvents } });
}

let root: string;
let keys: ReturnType<typeof generateKeyPairSync>;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-roi-"));
  keys = generateKeyPairSync("ed25519");
  out = [];
  err = [];
  proSpies.computeRoi.mockClear();
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

describe("runRoi — gating", () => {
  it("with NO license: prints the upsell, exit 0, reads NO events, computes nothing", async () => {
    const readAllEvents = vi.fn(roiReader());

    const code = await runRoi({
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
    expect(readAllEvents).not.toHaveBeenCalled();
    expect(proSpies.computeRoi).not.toHaveBeenCalled();
  });

  it.each(["abc", "0", "-5"])(
    "bad --price %s is rejected BEFORE any compute (stderr + exit 1)",
    async (bad) => {
      activatePro();
      const readAllEvents = vi.fn(roiReader());

      const code = await runRoi({
        storeRoot: root,
        now,
        publicKey: keys.publicKey,
        readAllEvents,
        price: bad,
        stdout,
        stderr,
      });

      expect(code).toBe(1);
      expect(err.join("\n")).toContain("--price");
      expect(out.join("\n")).toBe("");
      expect(readAllEvents).not.toHaveBeenCalled();
      expect(proSpies.computeRoi).not.toHaveBeenCalled();
    },
  );
});

describe("runRoi — render variants (entitled)", () => {
  beforeEach(() => activatePro());

  it("default price: honest ROI<1 headline + (est.) breakdown", async () => {
    const readAllEvents = vi.fn(roiReader());

    const code = await runRoi({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents,
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(readAllEvents).toHaveBeenCalledTimes(1);
    expect(proSpies.computeRoi).toHaveBeenCalledTimes(1);
    const text = out.join("\n");
    expect(text).toContain("hasn't paid for itself yet");
    expect(text).toContain("×");
    expect(text).toContain("(est.)");
    expect(text).toContain("$7.99");
  });

  it("--price $5 flips to the paid-for-itself headline (1.2×)", async () => {
    const code = await runRoi({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: roiReader(),
      price: "$5",
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("Pro $5.00/mo");
    expect(text).toContain("1.2×");
    expect(text).toContain("sessions' worth of context");
  });

  it("--price 5 ≡ --price $5 (both dollars)", async () => {
    const code = await runRoi({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: roiReader(),
      price: "5",
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Pro $5.00/mo");
  });

  it("--json emits the RoiReport", async () => {
    const code = await runRoi({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: roiReader(),
      json: true,
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("\n")) as {
      priceUsd: number;
      roiSoFar: number;
      paidForItself: boolean;
    };
    expect(parsed.priceUsd).toBe(7.99);
    expect(parsed.roiSoFar).toBeCloseTo(6 / 7.99);
    expect(parsed.paidForItself).toBe(false);
  });

  it("no in-month events → 'No savings recorded this month yet.', exit 0", async () => {
    const staleReader: SavingsEventReader = () => ({
      events: [event("2022-11-05T00:00:00.000Z", 4_000_000)],
      eventsByProject: {},
    });
    const code = await runRoi({
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
