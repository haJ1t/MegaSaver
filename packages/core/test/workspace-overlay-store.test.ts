import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CorePersistenceError } from "../src/errors.js";
import { readWorkspaceRules, readWorkspaceTools } from "../src/workspace-overlay-store.js";

const KEY = "0123456789abcdef" as never;
const PROJECT_ID = "00000000-0000-4000-8000-000000000001";

const RULE = {
  id: "00000000-0000-4000-8000-0000000000a1",
  projectId: PROJECT_ID,
  title: "no any",
  rule: "avoid any type",
  appliesTo: [],
  evidence: [],
  severity: "warning",
  confidence: "high",
  createdFrom: "manual",
  createdAt: "2026-06-14T00:00:00.000Z",
  updatedAt: "2026-06-14T00:00:00.000Z",
};

const TOOL = {
  id: "00000000-0000-4000-8000-0000000000b1",
  projectId: PROJECT_ID,
  name: "git status",
  description: "show working tree status",
  category: "git",
  risk: "safe",
  inputSchema: null,
  outputSchema: null,
  keywords: ["git", "status"],
  createdAt: "2026-06-14T00:00:00.000Z",
};

let store: string;

beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "mega-ws-overlay-"));
});

afterEach(() => {
  rmSync(store, { recursive: true, force: true });
});

describe("readWorkspaceRules", () => {
  it("reads a parsed rule from rules/<key>.jsonl", () => {
    mkdirSync(join(store, "rules"));
    writeFileSync(join(store, "rules", `${KEY}.jsonl`), `${JSON.stringify(RULE)}\n`);
    const rules = readWorkspaceRules(store, KEY);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.title).toBe("no any");
  });

  it("returns [] when the file is missing", () => {
    expect(readWorkspaceRules(store, KEY)).toEqual([]);
  });

  it("throws CorePersistenceError on a malformed line", () => {
    mkdirSync(join(store, "rules"));
    writeFileSync(join(store, "rules", `${KEY}.jsonl`), "{ not valid json\n");
    expect(() => readWorkspaceRules(store, KEY)).toThrow(CorePersistenceError);
  });
});

describe("readWorkspaceTools", () => {
  it("reads a parsed tool from tools/<key>.jsonl", () => {
    mkdirSync(join(store, "tools"));
    writeFileSync(join(store, "tools", `${KEY}.jsonl`), `${JSON.stringify(TOOL)}\n`);
    const tools = readWorkspaceTools(store, KEY);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("git status");
  });

  it("returns [] when the file is missing", () => {
    expect(readWorkspaceTools(store, KEY)).toEqual([]);
  });

  it("throws CorePersistenceError on a malformed line", () => {
    mkdirSync(join(store, "tools"));
    writeFileSync(join(store, "tools", `${KEY}.jsonl`), "not json at all\n");
    expect(() => readWorkspaceTools(store, KEY)).toThrow(CorePersistenceError);
  });
});
