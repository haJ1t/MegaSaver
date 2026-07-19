import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  MEGA_SAVER_HANDOFF_BLOCK_END,
  MEGA_SAVER_HANDOFF_BLOCK_START,
} from "@megasaver/connectors-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runHandoffClear } from "../../src/commands/handoff/clear.js";
import { ensureStoreReady } from "../../src/store.js";

const NOW = "2026-07-15T12:00:00.000Z";
const BLOCK = `${MEGA_SAVER_HANDOFF_BLOCK_START}\nhandoff body\n${MEGA_SAVER_HANDOFF_BLOCK_END}\n`;

let root: string;
let projectRoot: string;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-handoff-clear-store-"));
  projectRoot = mkdtempSync(join(tmpdir(), "megasaver-handoff-clear-proj-"));
  out = [];
  err = [];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

async function seedProject(): Promise<void> {
  const { registry } = await ensureStoreReady(root);
  registry.createProject({
    id: "22222222-2222-4222-8222-222222222222",
    name: "receiver",
    rootPath: projectRoot,
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
}

function seedFile(relativePath: string, content: string): string {
  const absPath = join(projectRoot, relativePath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, content);
  return absPath;
}

function run(target?: string) {
  return runHandoffClear({
    cwd: projectRoot,
    ...(target === undefined ? {} : { target }),
    ensureStore: () => ensureStoreReady(root),
    stdout,
    stderr,
  });
}

describe("runHandoffClear (free, ungated)", () => {
  it("outside a registered project: exit 1 pointing at mega init", async () => {
    expect(await run()).toBe(1);
    expect(err.join("\n")).toContain("mega init");
  });

  it("invalid --target: exit 1", async () => {
    await seedProject();
    expect(await run("gpt-6")).toBe(1);
    expect(err.join("\n")).toContain('invalid target "gpt-6"');
  });

  it("default clears the block from every present target file, keeps human text", async () => {
    await seedProject();
    const agents = seedFile("AGENTS.md", `# Agents\n\nhuman text\n\n${BLOCK}`);
    const claude = seedFile("CLAUDE.md", `# Claude\n\n${BLOCK}`);
    expect(await run()).toBe(0);
    for (const absPath of [agents, claude]) {
      const content = readFileSync(absPath, "utf8");
      expect(content).not.toContain(MEGA_SAVER_HANDOFF_BLOCK_START);
    }
    expect(readFileSync(agents, "utf8")).toContain("human text");
    expect(out.join("\n")).toContain("codex: cleared handoff block");
    expect(out.join("\n")).toContain("claude-code: cleared handoff block");
  });

  it("--target clears only that file", async () => {
    await seedProject();
    const agents = seedFile("AGENTS.md", BLOCK);
    const claude = seedFile("CLAUDE.md", BLOCK);
    expect(await run("codex")).toBe(0);
    expect(readFileSync(agents, "utf8")).not.toContain(MEGA_SAVER_HANDOFF_BLOCK_START);
    expect(readFileSync(claude, "utf8")).toContain(MEGA_SAVER_HANDOFF_BLOCK_START);
  });

  it("file without a block is left byte-identical", async () => {
    await seedProject();
    const original = "# Agents\n\nno block here\n";
    const agents = seedFile("AGENTS.md", original);
    expect(await run("codex")).toBe(0);
    expect(readFileSync(agents, "utf8")).toBe(original);
    expect(out.join("\n")).toContain("codex: no handoff block");
  });
});
