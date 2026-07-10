import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureIntent, intentFilePath, readSessionIntent } from "../../src/hooks/intent-run.js";

let storeRoot: string;
const cwd = "/some/project";
const wk = encodeWorkspaceKey(cwd);

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "intent-"));
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

describe("captureIntent", () => {
  it("writes {prompt, ts} to the workspace-keyed file", () => {
    captureIntent(storeRoot, { prompt: "fix the parser", cwd }, () => 123);
    const raw = readFileSync(intentFilePath(storeRoot, wk), "utf8");
    expect(JSON.parse(raw)).toEqual({ prompt: "fix the parser", ts: 123 });
  });

  it("writes nothing for an empty/whitespace prompt", () => {
    captureIntent(storeRoot, { prompt: "   ", cwd }, () => 1);
    expect(existsSync(intentFilePath(storeRoot, wk))).toBe(false);
  });

  it("writes nothing for a malformed payload", () => {
    captureIntent(storeRoot, { nope: true }, () => 1);
    expect(existsSync(intentFilePath(storeRoot, wk))).toBe(false);
  });

  it("redacts secrets in the prompt before persisting", () => {
    const secret = "AKIAIOSFODNN7EXAMPLE";
    captureIntent(storeRoot, { prompt: `use key ${secret} please`, cwd }, () => 1);
    const raw = readFileSync(intentFilePath(storeRoot, wk), "utf8");
    expect(raw).not.toContain(secret);
    expect(JSON.parse(raw).prompt).toBe("use key AKIA[REDACTED] please");
  });
});

describe("readSessionIntent", () => {
  it("returns undefined when the file is missing", () => {
    expect(readSessionIntent(storeRoot, wk)).toBeUndefined();
  });

  it("returns the prompt for a valid file", () => {
    captureIntent(storeRoot, { prompt: "add logging", cwd }, () => 1);
    expect(readSessionIntent(storeRoot, wk, undefined, () => 1)).toBe("add logging");
  });

  it("returns undefined for malformed JSON", () => {
    mkdirSync(dirname(intentFilePath(storeRoot, wk)), { recursive: true });
    writeFileSync(intentFilePath(storeRoot, wk), "{ not json", "utf8");
    expect(readSessionIntent(storeRoot, wk)).toBeUndefined();
  });

  it("returns undefined for an empty stored prompt", () => {
    mkdirSync(dirname(intentFilePath(storeRoot, wk)), { recursive: true });
    writeFileSync(intentFilePath(storeRoot, wk), JSON.stringify({ prompt: "", ts: 1 }), "utf8");
    expect(readSessionIntent(storeRoot, wk)).toBeUndefined();
  });

  it("returns undefined for valid JSON with a schema mismatch", () => {
    mkdirSync(dirname(intentFilePath(storeRoot, wk)), { recursive: true });
    writeFileSync(
      intentFilePath(storeRoot, wk),
      JSON.stringify({ prompt: "x", ts: "not-a-number" }),
      "utf8",
    );
    expect(readSessionIntent(storeRoot, wk)).toBeUndefined();
  });
});

describe("D17: per-session intent + TTL", () => {
  const sidA = "11111111-1111-4111-8111-111111111111";
  const sidB = "22222222-2222-4222-8222-222222222222";

  it("two sessions in one workspace read their own prompts", () => {
    captureIntent(storeRoot, { prompt: "fix the parser", cwd, session_id: sidA }, () => 1000);
    captureIntent(storeRoot, { prompt: "write the docs", cwd, session_id: sidB }, () => 1000);
    expect(readSessionIntent(storeRoot, wk, sidA, () => 1000)).toBe("fix the parser");
    expect(readSessionIntent(storeRoot, wk, sidB, () => 1000)).toBe("write the docs");
  });

  it("id-less payloads still work via the legacy latest-wins file", () => {
    captureIntent(storeRoot, { prompt: "legacy prompt", cwd }, () => 1000);
    expect(readSessionIntent(storeRoot, wk, undefined, () => 1000)).toBe("legacy prompt");
    // an unknown session id falls back to the legacy file
    expect(readSessionIntent(storeRoot, wk, sidA, () => 1000)).toBe("legacy prompt");
  });

  it("intent expires after 30 minutes", () => {
    const t0 = 1_000_000_000_000;
    captureIntent(storeRoot, { prompt: "old prompt", cwd, session_id: sidA }, () => t0);
    const late = () => t0 + 30 * 60_000 + 1;
    expect(readSessionIntent(storeRoot, wk, sidA, late)).toBeUndefined();
    expect(readSessionIntent(storeRoot, wk, undefined, late)).toBeUndefined();
  });

  it("a hostile session_id cannot escape the store (falls back to legacy)", () => {
    captureIntent(storeRoot, { prompt: "safe prompt", cwd, session_id: "../../evil" }, () => 1000);
    // per-session write was skipped (bad id); legacy file still written and readable
    expect(readSessionIntent(storeRoot, wk, "../../evil", () => 1000)).toBe("safe prompt");
  });
});
