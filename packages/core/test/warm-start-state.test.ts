import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readWarmStartState, stampWarmStartSeen } from "../src/warm-start-state.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-07-12T10:00:00.000Z";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-warmstate-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("warm-start state", () => {
  it("returns null when no state file exists", () => {
    expect(readWarmStartState(root, PROJECT_ID)).toBeNull();
  });

  it("round-trips a stamp", () => {
    stampWarmStartSeen(root, PROJECT_ID, NOW);
    expect(readWarmStartState(root, PROJECT_ID)).toEqual({ lastSeenAt: NOW });
  });

  it("returns null on schema mismatch (valid JSON, wrong shape)", () => {
    mkdirSync(join(root, "warm-start"), { recursive: true });
    writeFileSync(
      join(root, "warm-start", `${PROJECT_ID}.json`),
      JSON.stringify({ lastSeenAt: "not-a-datetime", extra: true }),
    );
    expect(readWarmStartState(root, PROJECT_ID)).toBeNull();
  });

  it("returns null on corrupt state instead of throwing", () => {
    mkdirSync(join(root, "warm-start"), { recursive: true });
    writeFileSync(join(root, "warm-start", `${PROJECT_ID}.json`), "{not json");
    expect(readWarmStartState(root, PROJECT_ID)).toBeNull();
  });

  it("never throws when the root is unwritable (best-effort stamp)", () => {
    expect(() => stampWarmStartSeen("/nonexistent/nope", PROJECT_ID, NOW)).not.toThrow();
  });
});
