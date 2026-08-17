import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  INTENT_TTL_MS,
  SAFE_SEGMENT,
  captureIntent,
  readLatestIntentRecord,
  readSessionIntent,
} from "../../src/hooks/intent-run.js";

let storeRoot: string;
const cwd = "/some/project";
const wk = encodeWorkspaceKey(cwd);

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "intent-record-"));
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

describe("readLatestIntentRecord", () => {
  it("returns the stored prompt and ts even past the ranking TTL", () => {
    const ts = 1_000_000;
    captureIntent(storeRoot, { prompt: "fix flaky auth test", cwd, session_id: "sess-1" }, () => ts);
    const past = ts + INTENT_TTL_MS + 60_000;
    expect(readSessionIntent(storeRoot, wk, "sess-1", () => past)).toBeUndefined();
    expect(readLatestIntentRecord(storeRoot, wk, "sess-1")).toEqual({ prompt: "fix flaky auth test", ts });
  });

  it("falls back to the legacy workspace file for an unknown session id", () => {
    captureIntent(storeRoot, { prompt: "ship recap", cwd, session_id: "sess-1" }, () => 5);
    expect(readLatestIntentRecord(storeRoot, wk, "other-session")).toEqual({ prompt: "ship recap", ts: 5 });
  });

  it("returns undefined when nothing was captured", () => {
    expect(readLatestIntentRecord(storeRoot, wk, "sess-1")).toBeUndefined();
  });

  it("exports the session-id gate used by the capsule hooks", () => {
    expect(SAFE_SEGMENT.test("abc-123")).toBe(true);
    expect(SAFE_SEGMENT.test("../evil")).toBe(false);
  });
});
