import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contextPackSchema } from "@megasaver/context-pruner";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import { buildIndex } from "@megasaver/indexer";
import { afterEach, describe, expect, it } from "vitest";
import { McpBridgeError } from "../../src/errors.js";
import { handleGetEditImpact } from "../../src/tools/get-edit-impact.js";

const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-07-02T00:00:00.000Z";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeProject(repo: string) {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID as never,
    name: "demo",
    rootPath: repo,
    createdAt: TS,
    updatedAt: TS,
  });
  return registry;
}

function makeDirs(prefix: string): { store: string; repo: string } {
  const store = mkdtempSync(join(tmpdir(), `${prefix}-store-`));
  const repo = mkdtempSync(join(tmpdir(), `${prefix}-repo-`));
  dirs.push(store, repo);
  return { store, repo };
}

async function callerFixture(prefix: string) {
  const { store, repo } = makeDirs(prefix);
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "a.ts"), "export function alpha() {\n  return 1;\n}\n");
  writeFileSync(
    join(repo, "src", "b.ts"),
    'import { alpha } from "./a.js";\nexport function beta() {\n  return alpha();\n}\n',
  );
  writeFileSync(
    join(repo, "src", "b.test.ts"),
    'import { beta } from "./b.js";\nexport function betaCheck() {\n  return beta();\n}\n',
  );
  await buildIndex({ rootDir: repo, storeDir: store, projectId: PROJECT_ID as never });
  return { store, repo, registry: makeProject(repo) };
}

describe("get_edit_impact", () => {
  it("returns impacted callers and suggested tests for explicit changedFiles", async () => {
    const { store, registry } = await callerFixture("edit-impact");

    const result = handleGetEditImpact(
      { registry, storeRoot: store },
      { projectId: PROJECT_ID, changedFiles: ["src/a.ts"] },
    );

    expect(result.changedFiles).toEqual(["src/a.ts"]);
    expect(result.unmatchedFiles).toEqual([]);
    expect(result.seeds).toEqual(["alpha"]);
    expect(contextPackSchema.safeParse(result.pack).success).toBe(true);
    expect(result.pack.task).toBe("edit-impact: alpha");
    const names = result.pack.included.map((b) => b.name);
    expect(names).toContain("alpha");
    expect(names).toContain("beta");
    expect(names).toContain("betaCheck");
    expect(result.suggestedTests).toEqual(["src/b.test.ts"]);
    expect(result.reason).toBeUndefined();
  });

  it("suggests a bare-describe test file via the filename heuristic", async () => {
    // Real Vitest/Jest files are top-level describe() calls: the TS extractor
    // emits NO named blocks for them, so they can never be indexed callers.
    const { store, repo } = makeDirs("edit-impact-heuristic");
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src", "a.ts"), "export function alpha() {\n  return 1;\n}\n");
    writeFileSync(
      join(repo, "src", "a.test.ts"),
      'import { describe, it } from "vitest";\nimport { alpha } from "./a.js";\ndescribe("alpha", () => {\n  it("returns", () => {\n    alpha();\n  });\n});\n',
    );
    await buildIndex({ rootDir: repo, storeDir: store, projectId: PROJECT_ID as never });
    const registry = makeProject(repo);

    const result = handleGetEditImpact(
      { registry, storeRoot: store },
      { projectId: PROJECT_ID, changedFiles: ["src/a.ts"] },
    );

    // Sanity: the bare-describe file contributed no blocks to the pack.
    expect(result.pack.included.map((b) => b.filePath)).not.toContain("src/a.test.ts");
    expect(result.suggestedTests).toEqual(["src/a.test.ts"]);
  });

  it("surfaces a budget-cut test caller via the calledBy walk", async () => {
    // Seed with more callers than DEFAULT_LIMIT=8 so the indexed test block is
    // cut from pack.included; it must still be suggested. The test file's stem
    // and directory intentionally match nothing, so the filename heuristic
    // cannot rescue it — only the block-type scan over the blast radius can.
    const { store, repo } = makeDirs("edit-impact-budget");
    mkdirSync(join(repo, "src"));
    mkdirSync(join(repo, "test"));
    writeFileSync(join(repo, "src", "hot.ts"), "export function hot() {\n  return 1;\n}\n");
    for (let i = 0; i < 9; i += 1) {
      writeFileSync(
        join(repo, "src", `c${i}.ts`),
        `import { hot } from "./hot.js";\nexport function use${i}() {\n  return hot();\n}\n`,
      );
    }
    writeFileSync(
      join(repo, "test", "zz.spec.ts"),
      'import { hot } from "../src/hot.js";\nexport function hotSpecCheck() {\n  return hot();\n}\n',
    );
    await buildIndex({ rootDir: repo, storeDir: store, projectId: PROJECT_ID as never });
    const registry = makeProject(repo);

    const result = handleGetEditImpact(
      { registry, storeRoot: store },
      { projectId: PROJECT_ID, changedFiles: ["src/hot.ts"] },
    );

    expect(result.pack.included.map((b) => b.filePath)).not.toContain("test/zz.spec.ts");
    expect(result.suggestedTests).toContain("test/zz.spec.ts");
  });

  it("normalizes absolute and backslash changedFiles to manifest keys", async () => {
    const { store, repo, registry } = await callerFixture("edit-impact-norm");

    const absolute = handleGetEditImpact(
      { registry, storeRoot: store },
      { projectId: PROJECT_ID, changedFiles: [join(repo, "src", "a.ts")] },
    );
    expect(absolute.changedFiles).toEqual(["src/a.ts"]);
    expect(absolute.seeds).toEqual(["alpha"]);
    expect(absolute.unmatchedFiles).toEqual([]);

    const backslash = handleGetEditImpact(
      { registry, storeRoot: store },
      { projectId: PROJECT_ID, changedFiles: ["src\\a.ts", "./src/b.ts"] },
    );
    expect(backslash.changedFiles).toEqual(["src/a.ts", "src/b.ts"]);
    expect(backslash.seeds).toContain("alpha");
    expect(backslash.seeds).toContain("beta");
    expect(backslash.unmatchedFiles).toEqual([]);
  });

  it("reports files without a manifest entry in unmatchedFiles", async () => {
    const { store, registry } = await callerFixture("edit-impact-unmatched");

    const result = handleGetEditImpact(
      { registry, storeRoot: store },
      { projectId: PROJECT_ID, changedFiles: ["nope/missing.ts", "src/a.ts"] },
    );

    expect(result.unmatchedFiles).toEqual(["nope/missing.ts"]);
    expect(result.seeds).toEqual(["alpha"]);
  });

  it("treats prototype-chain names as unmatched without throwing", async () => {
    const { store, registry } = await callerFixture("edit-impact-proto");

    const result = handleGetEditImpact(
      { registry, storeRoot: store },
      { projectId: PROJECT_ID, changedFiles: ["__proto__", "constructor", "toString"] },
    );

    expect(result.seeds).toEqual([]);
    expect(result.unmatchedFiles).toEqual(["__proto__", "constructor", "toString"]);
    expect(result.pack.included).toEqual([]);
  });

  it("enforces maxTokens as a shared cap across the merged union", async () => {
    const { store, registry } = await callerFixture("edit-impact-shared");

    const uncapped = handleGetEditImpact(
      { registry, storeRoot: store },
      { projectId: PROJECT_ID, changedFiles: ["src/a.ts", "src/b.ts"] },
    );
    // Each 3-line block estimates to 36 tokens; the union holds several.
    expect(uncapped.pack.budget.maxTokens).toBeNull();
    expect(uncapped.pack.included.length).toBeGreaterThan(1);

    const capped = handleGetEditImpact(
      { registry, storeRoot: store },
      { projectId: PROJECT_ID, changedFiles: ["src/a.ts", "src/b.ts"], maxTokens: 40 },
    );
    expect(capped.pack.budget.maxTokens).toBe(40);
    expect(capped.pack.budget.usedTokens).toBeLessThanOrEqual(40);
    expect(capped.pack.included.length).toBeLessThan(uncapped.pack.included.length);
    const budgetCut = capped.pack.excluded.filter((b) =>
      b.reasons.includes("excluded: cut by token/limit budget"),
    );
    expect(budgetCut.length).toBeGreaterThan(0);
  });

  it("forwards limit to each per-seed impact pack", async () => {
    const { store, registry } = await callerFixture("edit-impact-limit");

    const result = handleGetEditImpact(
      { registry, storeRoot: store },
      { projectId: PROJECT_ID, changedFiles: ["src/a.ts"], limit: 1 },
    );

    expect(result.pack.included.map((b) => b.name)).toEqual(["alpha"]);
  });

  it("returns reason git-unavailable on a non-git root with no changedFiles", () => {
    const repo = mkdtempSync(join(tmpdir(), "edit-impact-nogit-"));
    dirs.push(repo);
    const registry = makeProject(repo);

    const result = handleGetEditImpact({ registry, storeRoot: repo }, { projectId: PROJECT_ID });

    expect(result.changedFiles).toEqual([]);
    expect(result.unmatchedFiles).toEqual([]);
    expect(result.seeds).toEqual([]);
    expect(result.suggestedTests).toEqual([]);
    expect(result.pack.included).toEqual([]);
    expect(result.reason).toBe("git-unavailable");
    expect(contextPackSchema.safeParse(result.pack).success).toBe(true);
  });

  it("returns reason no-changes for an explicit empty changedFiles list", async () => {
    const { store, registry } = await callerFixture("edit-impact-explicit-empty");

    const result = handleGetEditImpact(
      { registry, storeRoot: store },
      { projectId: PROJECT_ID, changedFiles: [] },
    );

    expect(result.changedFiles).toEqual([]);
    expect(result.reason).toBe("no-changes");
  });

  it("derives changedFiles from git and reports no-changes on a clean tree", async () => {
    const { store, repo, registry } = await callerFixture("edit-impact-git");
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
    git("init", "-q");
    git("add", ".");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");

    const clean = handleGetEditImpact({ registry, storeRoot: store }, { projectId: PROJECT_ID });
    expect(clean.changedFiles).toEqual([]);
    expect(clean.reason).toBe("no-changes");

    writeFileSync(join(repo, "src", "a.ts"), "export function alpha() {\n  return 2;\n}\n");
    const dirty = handleGetEditImpact({ registry, storeRoot: store }, { projectId: PROJECT_ID });
    expect(dirty.changedFiles).toEqual(["src/a.ts"]);
    expect(dirty.seeds).toEqual(["alpha"]);
    expect(dirty.reason).toBeUndefined();
  });

  it("caps seeds at 8 in deterministic block order", async () => {
    const { store, repo } = makeDirs("edit-impact-cap");
    mkdirSync(join(repo, "src"));
    const fns = Array.from(
      { length: 10 },
      (_, i) => `export function f${i}() {\n  return ${i};\n}`,
    );
    writeFileSync(join(repo, "src", "many.ts"), `${fns.join("\n")}\n`);
    await buildIndex({ rootDir: repo, storeDir: store, projectId: PROJECT_ID as never });
    const registry = makeProject(repo);

    const result = handleGetEditImpact(
      { registry, storeRoot: store },
      { projectId: PROJECT_ID, changedFiles: ["src/many.ts"] },
    );

    expect(result.seeds).toEqual(["f0", "f1", "f2", "f3", "f4", "f5", "f6", "f7"]);
  });

  it("rejects a missing projectId", () => {
    const registry = createInMemoryCoreRegistry();
    expect(() => handleGetEditImpact({ registry, storeRoot: "/tmp" }, {})).toThrow(McpBridgeError);
  });

  it("rejects an unknown project", () => {
    const registry = createInMemoryCoreRegistry();
    expect(() =>
      handleGetEditImpact(
        { registry, storeRoot: "/tmp" },
        { projectId: "99999999-9999-4999-8999-999999999999" },
      ),
    ).toThrow(/project not found/);
  });
});
