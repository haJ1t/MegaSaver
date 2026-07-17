import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_AUTOPILOT_POLICY,
  readAutopilotPolicy,
  readDigestState,
  writeAutopilotPolicy,
  writeDigestState,
} from "../src/autopilot-store.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-autopilot-store-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("autopilot policy store", () => {
  it("defaults to disabled when no file exists (fail-closed)", () => {
    expect(readAutopilotPolicy(root)).toEqual({
      enabled: false,
      autoApproveTypes: ["bug", "test_behavior"],
      autoApproveMinConfidence: "high",
      maxAutoApprovesPerSession: 10,
    });
  });

  it("round-trips a written policy", () => {
    const policy = {
      ...DEFAULT_AUTOPILOT_POLICY,
      enabled: true,
      maxAutoApprovesPerSession: 3,
    };
    writeAutopilotPolicy(root, policy);
    expect(readAutopilotPolicy(root)).toEqual(policy);
  });

  it("falls back to the disabled default on a corrupt or partial file", () => {
    writeAutopilotPolicy(root, { ...DEFAULT_AUTOPILOT_POLICY, enabled: true });
    writeFileSync(join(root, "autopilot.json"), "{not json");
    expect(readAutopilotPolicy(root).enabled).toBe(false);
    // A partial object must fail on its missing required keys, not half-apply the
    // one it does carry. (Unknown-key rejection is pinned separately, below.)
    writeFileSync(join(root, "autopilot.json"), JSON.stringify({ enabled: true }));
    expect(readAutopilotPolicy(root).enabled).toBe(false);
  });

  // Expectations here are hardcoded, never `DEFAULT_AUTOPILOT_POLICY`: if a read
  // aliased the singleton, a caller mutation would poison the constant too and a
  // comparison against it would vacuously pass.
  it("returns a fresh copy per read — caller mutation cannot poison the default", () => {
    const first = readAutopilotPolicy(root);
    first.enabled = true;
    first.autoApproveTypes.push("decision");
    first.maxAutoApprovesPerSession = 999;

    expect(readAutopilotPolicy(root)).toEqual({
      enabled: false,
      autoApproveTypes: ["bug", "test_behavior"],
      autoApproveMinConfidence: "high",
      maxAutoApprovesPerSession: 10,
    });
  });

  it("leaves no tmp files behind (atomic rename)", () => {
    writeAutopilotPolicy(root, DEFAULT_AUTOPILOT_POLICY);
    expect(readdirSync(root).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(readdirSync(root)).toContain("autopilot.json");
  });
});

// The fail-closed read is this module's security claim, so every field
// constraint is pinned: loosening the schema must break a test, not ship quietly.
// Each fixture sets `enabled: true` — the assertion is that a hostile file can
// never talk the reader into an enabled policy.
describe("autopilot policy store — hostile input fails closed", () => {
  const withField = (over: Record<string, unknown>): string =>
    JSON.stringify({ ...DEFAULT_AUTOPILOT_POLICY, enabled: true, ...over });

  const cases: [string, string][] = [
    ["wrong-type enabled", withField({ enabled: "yes" })],
    ["unknown auto-approve type", withField({ autoApproveTypes: ["bug", "not_a_real_type"] })],
    ["non-array auto-approve types", withField({ autoApproveTypes: "bug" })],
    ["wrong confidence literal", withField({ autoApproveMinConfidence: "medium" })],
    ["zero cap", withField({ maxAutoApprovesPerSession: 0 })],
    ["negative cap", withField({ maxAutoApprovesPerSession: -1 })],
    ["non-integer cap", withField({ maxAutoApprovesPerSession: 2.5 })],
    ["unknown extra key", withField({ extraField: "nope" })],
    ["invalid JSON", "{not json"],
    ["empty file", ""],
    ["top-level array", "[]"],
    ["top-level null", "null"],
  ];

  it.each(cases)("%s", (_name, contents) => {
    writeFileSync(join(root, "autopilot.json"), contents);
    expect(() => readAutopilotPolicy(root)).not.toThrow();
    expect(readAutopilotPolicy(root)).toEqual({
      enabled: false,
      autoApproveTypes: ["bug", "test_behavior"],
      autoApproveMinConfidence: "high",
      maxAutoApprovesPerSession: 10,
    });
  });

  it("unreadable file — a directory in its place (EISDIR)", () => {
    mkdirSync(join(root, "autopilot.json"));
    expect(() => readAutopilotPolicy(root)).not.toThrow();
    expect(readAutopilotPolicy(root).enabled).toBe(false);
  });
});

describe("digest state store", () => {
  it("defaults to null lastDigestAt when missing or corrupt", () => {
    expect(readDigestState(root)).toEqual({ lastDigestAt: null });
    writeFileSync(join(root, "digest-state.json"), "nope");
    expect(readDigestState(root)).toEqual({ lastDigestAt: null });
  });

  it("round-trips a written state", () => {
    writeDigestState(root, { lastDigestAt: "2026-07-15T12:00:00.000Z" });
    expect(readDigestState(root)).toEqual({ lastDigestAt: "2026-07-15T12:00:00.000Z" });
  });

  it("creates the store root on write when missing", () => {
    const nested = join(root, "does", "not", "exist");
    writeDigestState(nested, { lastDigestAt: null });
    expect(readDigestState(nested)).toEqual({ lastDigestAt: null });
  });
});
