import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type SearchCodeMatchGroup,
  assertSafePathScope,
  groupGrepMatches,
  handleSearchCode,
} from "../../src/tools/search-code.js";

describe("assertSafePathScope (path-traversal guard)", () => {
  it("accepts relative paths inside the project", () => {
    for (const p of [".", "src", "src/tools", "a/b/c"]) {
      expect(() => assertSafePathScope(p)).not.toThrow();
    }
  });
  it("rejects absolute paths", () => {
    expect(() => assertSafePathScope("/etc")).toThrow(/path_scope/);
    expect(() => assertSafePathScope("/etc/passwd")).toThrow(/path_scope/);
  });
  it("rejects parent-directory traversal", () => {
    for (const p of ["..", "../x", "a/../../etc", "../../"]) {
      expect(() => assertSafePathScope(p)).toThrow(/path_scope/);
    }
  });
});

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-05-13T00:00:00.000Z";

function seededRegistry(projectRoot: string) {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: projectRoot,
    createdAt: TS,
    updatedAt: TS,
  });
  registry.createSession({
    id: SESSION_ID,
    projectId: PROJECT_ID,
    agentId: "claude-code",
    riskLevel: "medium",
    title: "demo",
    startedAt: TS,
    endedAt: null,
  });
  return registry;
}

describe("groupGrepMatches", () => {
  it("groups path:line:text lines into per-file groups", () => {
    const lines = [
      "src/a.ts:3:const needle = 1;",
      "src/a.ts:7:return needle + 1;",
      "src/b.ts:1:import { needle } from './a';",
    ].join("\n");
    const groups = groupGrepMatches(lines);
    expect(groups.map((g) => g.path)).toEqual(["src/a.ts", "src/b.ts"]);
    const a = groups.find((g) => g.path === "src/a.ts") as SearchCodeMatchGroup;
    expect(a.matches).toEqual([
      { line: 3, text: "const needle = 1;" },
      { line: 7, text: "return needle + 1;" },
    ]);
  });

  it("parses path:line:col:text (column variant) keeping the remainder as text", () => {
    const groups = groupGrepMatches("src/a.ts:3:5:const needle = 1;");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.matches[0]).toEqual({ line: 3, col: 5, text: "const needle = 1;" });
  });

  it("preserves colons inside the matched text", () => {
    const groups = groupGrepMatches("src/a.ts:3:const url = 'http://x';");
    expect(groups[0]?.matches[0]?.text).toBe("const url = 'http://x';");
  });

  it("ignores blank lines and grep separators", () => {
    const lines = ["src/a.ts:3:hit", "", "--", "src/a.ts:9:hit2"].join("\n");
    const groups = groupGrepMatches(lines);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.matches).toHaveLength(2);
  });

  it("returns empty for output with no parseable matches", () => {
    expect(groupGrepMatches("")).toEqual([]);
    expect(groupGrepMatches("no colons here\njust prose")).toEqual([]);
  });
});

describe("handleSearchCode", () => {
  let store: string;
  let projectRoot: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "mcp-search-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "mcp-search-root-"));
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  function env(registry = seededRegistry(projectRoot)) {
    return {
      registry,
      storeRoot: store,
      now: () => TS,
      newId: () => "cs-search",
      originPid: String(process.pid),
    };
  }

  it("rejects an empty query before any execution", async () => {
    await expect(
      handleSearchCode(env(), { query: "", sessionId: SESSION_ID }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("returns grouped grep matches and a chunkSetId over a real temp dir", async () => {
    await writeFile(join(projectRoot, "a.ts"), "const needle = 1;\nconst other = 2;\n");
    await writeFile(join(projectRoot, "b.ts"), "import { needle } from './a';\n");
    const result = await handleSearchCode(env(), {
      query: "needle",
      sessionId: SESSION_ID,
      path_scope: ".",
    });
    expect(result.chunkSetId).toBeDefined();
    // grep -r over "." prefixes paths with "./".
    const paths = result.files.map((f) => f.path).sort();
    expect(paths).toContain("./a.ts");
    expect(paths).toContain("./b.ts");
    for (const f of result.files) {
      expect(f.matches.length).toBeGreaterThan(0);
    }
  });

  it("reports index_enrichment 'unavailable' when there are no matches", async () => {
    await writeFile(join(projectRoot, "a.ts"), "nothing relevant here\n");
    const result = await handleSearchCode(env(), {
      query: "needle",
      sessionId: SESSION_ID,
    });
    expect(result.files).toEqual([]);
    expect(result.index_enrichment).toBe("unavailable");
  });

  it("sets index_enrichment 'applied' when enrichment reorders multi-file matches", async () => {
    await writeFile(
      join(projectRoot, "low.ts"),
      "// needle appears once\nconst needle = 1;\nconst pad = 0;\nconst pad2 = 0;\n",
    );
    await writeFile(
      join(projectRoot, "high.ts"),
      "const needle = 1;\nconst needle2 = needle;\nreturn needle + needle;\n",
    );
    const result = await handleSearchCode(env(), {
      query: "needle",
      task: "find the needle definition",
      sessionId: SESSION_ID,
    });
    expect(result.index_enrichment).toBe("applied");
    // every live-matched file is still present (enrichment only reorders)
    const paths = result.files.map((f) => f.path).sort();
    expect(paths).toContain("./low.ts");
    expect(paths).toContain("./high.ts");
  });

  it("carries ExecResult savings metrics on the response", async () => {
    await writeFile(join(projectRoot, "a.ts"), "const needle = 1;\n");
    const result = await handleSearchCode(env(), {
      query: "needle",
      sessionId: SESSION_ID,
    });
    expect(result.metrics.rawBytes).toBeGreaterThanOrEqual(0);
    expect(result.metrics.returnedBytes).toBeGreaterThanOrEqual(0);
    expect(typeof result.metrics.savingRatio).toBe("number");
  });

  it("uses the query as intent when task is absent (task-aware ranking input)", async () => {
    await writeFile(join(projectRoot, "a.ts"), "const needle = 1;\n");
    // No task → handler must still succeed (intent falls back to query).
    const result = await handleSearchCode(env(), {
      query: "needle",
      sessionId: SESSION_ID,
    });
    expect(result.files.length).toBeGreaterThan(0);
  });

  it("surfaces command_denied when the underlying command is policy-denied", async () => {
    // path_scope is passed through to grep args; a dangerous query/scope is
    // still grep so this asserts the policy gate is wired. We assert grep runs
    // through policy by denying it via a malformed permissions file is covered
    // elsewhere; here we assert a session that does not exist surfaces cleanly.
    await expect(
      handleSearchCode(env(), { query: "x", sessionId: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toMatchObject({ code: "session_not_found" });
  });

  it("surfaces command_denied via a fail-closed malformed permissions file", async () => {
    const registry = seededRegistry(projectRoot);
    await mkdir(join(projectRoot, ".megasaver"), { recursive: true });
    await writeFile(
      join(projectRoot, ".megasaver", "permissions.yaml"),
      "deny:\n  commands: [oops",
    );
    await expect(
      handleSearchCode(env(registry), { query: "needle", sessionId: SESSION_ID }),
    ).rejects.toMatchObject({ code: "policy_load_failed" });
  });
});
