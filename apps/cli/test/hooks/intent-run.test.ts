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
});

describe("readSessionIntent", () => {
  it("returns undefined when the file is missing", () => {
    expect(readSessionIntent(storeRoot, wk)).toBeUndefined();
  });

  it("returns the prompt for a valid file", () => {
    captureIntent(storeRoot, { prompt: "add logging", cwd }, () => 1);
    expect(readSessionIntent(storeRoot, wk)).toBe("add logging");
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
