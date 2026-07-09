// apps/cli/test/commands/savings-budget.test.ts
import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { budgetPath, readBudget } from "@megasaver/core";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBudgetClear, runBudgetSet, runBudgetShow } from "../../src/commands/savings/budget.js";
import { PRO_ANALYTICS_UPSELL } from "../../src/commands/savings/shared.js";

type Payload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(privateKey: KeyObject, payload: Payload): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

const now = () => Date.UTC(2026, 6, 9, 12, 0, 0);

let root: string;
let keys: ReturnType<typeof generateKeyPairSync>;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-budget-"));
  keys = generateKeyPairSync("ed25519");
  out = [];
  err = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function activatePro(): void {
  const key = signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "c1", iat: 0, exp: null });
  expect(activateLicense(root, key, { publicKey: keys.publicKey, now }).ok).toBe(true);
}

const gate = () => ({ storeRoot: root, now, publicKey: keys.publicKey, stdout, stderr });

describe("budget commands — gating", () => {
  it("free tier: upsell, exit 0, nothing written or read", () => {
    expect(runBudgetSet({ ...gate(), value: "$20" })).toBe(0);
    expect(out.join("\n")).toBe(PRO_ANALYTICS_UPSELL);
    expect(existsSync(budgetPath(root))).toBe(false);

    out = [];
    expect(runBudgetShow(gate())).toBe(0);
    expect(out.join("\n")).toBe(PRO_ANALYTICS_UPSELL);

    out = [];
    expect(runBudgetClear(gate())).toBe(0);
    expect(out.join("\n")).toBe(PRO_ANALYTICS_UPSELL);
  });
});

describe("budget set/show/clear — entitled", () => {
  beforeEach(() => activatePro());

  it("set $20 writes a v1 dollars/month budget and show reads it back", () => {
    expect(runBudgetSet({ ...gate(), value: "$20" })).toBe(0);
    expect(readBudget(root)).toEqual({ version: 1, period: "month", kind: "dollars", amount: 20 });
    expect(out.join("\n")).toContain("Budget set: save $20 per month.");

    out = [];
    expect(runBudgetShow(gate())).toBe(0);
    expect(out.join("\n")).toContain("Budget: save $20 per month.");
  });

  it("set 5000000 --period week writes a tokens/week budget", () => {
    expect(runBudgetSet({ ...gate(), value: "5000000", period: "week" })).toBe(0);
    expect(readBudget(root)).toEqual({
      version: 1,
      period: "week",
      kind: "tokens",
      amount: 5_000_000,
    });
  });

  it("rejects bad values and bad periods with stderr + exit 1, writing nothing", () => {
    for (const value of ["abc", "0", "-5", "$0"]) {
      expect(runBudgetSet({ ...gate(), value })).toBe(1);
      expect(existsSync(budgetPath(root))).toBe(false);
    }
    expect(runBudgetSet({ ...gate(), value: "$20", period: "day" })).toBe(1);
    expect(existsSync(budgetPath(root))).toBe(false);
    expect(err.length).toBe(5);
  });

  it("show with no budget prints an honest note, exit 0", () => {
    expect(runBudgetShow(gate())).toBe(0);
    expect(out.join("\n")).toContain("No budget set.");
  });

  it("show with a corrupt file points at the path, exit 1", () => {
    mkdirSync(join(root, "stats"), { recursive: true });
    writeFileSync(budgetPath(root), "{broken");
    expect(runBudgetShow(gate())).toBe(1);
    expect(err.join("\n")).toContain("corrupt");
    expect(err.join("\n")).toContain(budgetPath(root));
  });

  it("clear removes the budget and is idempotent", () => {
    runBudgetSet({ ...gate(), value: "$20" });
    expect(runBudgetClear(gate())).toBe(0);
    expect(readBudget(root)).toBeNull();
    expect(runBudgetClear(gate())).toBe(0); // second clear still exit 0
  });

  it("--json contracts: set {budget}, show {status,budget}, clear {cleared}", () => {
    expect(runBudgetSet({ ...gate(), value: "$20", json: true })).toBe(0);
    expect(JSON.parse(out[0] as string)).toEqual({
      budget: { version: 1, period: "month", kind: "dollars", amount: 20 },
    });
    out = [];
    expect(runBudgetShow({ ...gate(), json: true })).toBe(0);
    expect(JSON.parse(out[0] as string)).toEqual({
      status: "ok",
      budget: { version: 1, period: "month", kind: "dollars", amount: 20 },
    });
    out = [];
    expect(runBudgetClear({ ...gate(), json: true })).toBe(0);
    expect(JSON.parse(out[0] as string)).toEqual({ cleared: true });
  });
});
