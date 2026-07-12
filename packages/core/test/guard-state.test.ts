import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GUARD_STATE,
  GUARD_STATE_MAX_SESSIONS,
  readGuardState,
  writeGuardState,
} from "../src/guard-state.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-guardstate-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("guard state", () => {
  it("returns null when no state file exists", () => {
    expect(readGuardState(root, PROJECT_ID)).toBeNull();
  });

  it("round-trips a written state", () => {
    const state = {
      ...DEFAULT_GUARD_STATE,
      mode: "strict" as const,
      mutedIds: ["x"],
      sessions: {
        s1: {
          firedIds: ["x"],
          intercepts: { e1: { command: "c", signatures: ["TS2322"], candidateId: "x" } },
        },
      },
    };
    writeGuardState(root, PROJECT_ID, state);
    expect(readGuardState(root, PROJECT_ID)).toEqual(state);
  });

  it("returns null on corrupt/wrong-shape file instead of throwing", () => {
    mkdirSync(join(root, "guard"), { recursive: true });
    writeFileSync(join(root, "guard", `${PROJECT_ID}.json`), "{not json");
    expect(readGuardState(root, PROJECT_ID)).toBeNull();
    writeFileSync(join(root, "guard", `${PROJECT_ID}.json`), JSON.stringify({ mode: "nope" }));
    expect(readGuardState(root, PROJECT_ID)).toBeNull();
  });

  it("evicts the oldest sessions beyond GUARD_STATE_MAX_SESSIONS on write", () => {
    const sessions: Record<string, { firedIds: string[]; intercepts: Record<string, never> }> = {};
    for (let i = 0; i <= GUARD_STATE_MAX_SESSIONS; i += 1) {
      sessions[`s${i}`] = { firedIds: [], intercepts: {} };
    }
    writeGuardState(root, PROJECT_ID, { ...DEFAULT_GUARD_STATE, sessions });
    const read = readGuardState(root, PROJECT_ID);
    expect(Object.keys(read?.sessions ?? {}).length).toBe(GUARD_STATE_MAX_SESSIONS);
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    expect(read?.sessions["s0"]).toBeUndefined(); // insertion-order eviction
  });

  it("write never throws on an unwritable root (best-effort)", () => {
    expect(() =>
      writeGuardState("/nonexistent/nope", PROJECT_ID, DEFAULT_GUARD_STATE),
    ).not.toThrow();
  });
});
