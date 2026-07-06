import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TokenSaverEvent } from "@megasaver/core";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type SavingsEventReader,
  runSavingsExport,
  runSavingsHistory,
} from "../../src/commands/savings/index.js";

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
    // The gate ran FIRST — the Pro compute path was never entered.
    expect(readAllEvents).not.toHaveBeenCalled();
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
