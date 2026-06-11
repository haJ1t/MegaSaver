import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runOnce } from "../src/cli.ts";

async function writeNested(root: string, relative: string, content: string): Promise<void> {
  const full = join(root, relative);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
}

type Capture = { out: string[]; err: string[] };

function newCapture(): Capture {
  return { out: [], err: [] };
}

async function seedRepoLikeRoot(root: string): Promise<void> {
  await mkdir(join(root, "docs/conventions"), { recursive: true });
  // Minimum subset of canonical sources used by the real manifest. Empty
  // bodies are fine — the runner only cares about file existence + diff.
  for (const file of [
    "mission.md",
    "stack-and-commands.md",
    "process-discipline.md",
    "code-conventions.md",
    "git-and-commits.md",
    "risk-modes.md",
    "multi-agent-dogfood.md",
    "anti-patterns.md",
    "repo-layout.md",
    "language.md",
    "definition-of-done.md",
    "skill-routing.md",
    "agent-routing.md",
    "wiki-first.md",
  ]) {
    await writeFile(join(root, "docs/conventions", file), `# ${file}\n\nbody of ${file}\n`);
  }
}

describe("runOnce CLI", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mega-conventions-cli-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("rejects conflicting mode flags with exit code 2", async () => {
    const c = newCapture();
    const outcome = await runOnce({
      repoRoot: root,
      check: true,
      write: true,
      fix: false,
      list: false,
      stdout: (l) => c.out.push(l),
      stderr: (l) => c.err.push(l),
    });
    expect(outcome.exitCode).toBe(2);
    expect(c.err.join("\n")).toContain("mutually exclusive");
  });

  it("--list prints the manifest and exits 0", async () => {
    const c = newCapture();
    const outcome = await runOnce({
      repoRoot: root,
      check: false,
      write: false,
      fix: false,
      list: true,
      stdout: (l) => c.out.push(l),
      stderr: (l) => c.err.push(l),
    });
    expect(outcome.exitCode).toBe(0);
    const joined = c.out.join("\n");
    expect(joined).toContain("agents-md");
    expect(joined).toContain("cursor-context");
    expect(joined).toContain("cursor-conventions");
    expect(joined).toContain("cursor-discipline");
  });

  it("--check exits 0 when every consumer is in sync (round-trip)", async () => {
    await seedRepoLikeRoot(root);
    // Seed every consumer with a freshly rendered block tree so check passes.
    // We exploit --write to do the seeding, then re-run --check.
    await writeNested(root, "CLAUDE.md", claudeTemplate());
    await writeNested(root, "AGENTS.md", agentsTemplate());
    await writeNested(root, ".cursor/rules/mega-context.mdc", cursorContextTemplate());
    await writeNested(root, ".cursor/rules/mega-conventions.mdc", cursorConventionsTemplate());
    await writeNested(root, ".cursor/rules/mega-discipline.mdc", cursorDisciplineTemplate());

    const c1 = newCapture();
    const w = await runOnce({
      repoRoot: root,
      check: false,
      write: true,
      fix: false,
      list: false,
      stdout: (l) => c1.out.push(l),
      stderr: (l) => c1.err.push(l),
    });
    expect(w.exitCode).toBe(0);

    const c2 = newCapture();
    const r = await runOnce({
      repoRoot: root,
      check: true,
      write: false,
      fix: false,
      list: false,
      stdout: (l) => c2.out.push(l),
      stderr: (l) => c2.err.push(l),
    });
    expect(r.exitCode).toBe(0);
    expect(c2.out.join("\n")).toMatch(/ok\s+AGENTS\.md/);
  });

  it("--check exits 1 when drift exists and prints diff identifying the file", async () => {
    await seedRepoLikeRoot(root);
    await writeNested(root, "CLAUDE.md", claudeTemplate());
    await writeNested(root, "AGENTS.md", agentsTemplate());
    await writeNested(root, ".cursor/rules/mega-context.mdc", cursorContextTemplate());
    await writeNested(root, ".cursor/rules/mega-conventions.mdc", cursorConventionsTemplate());
    await writeNested(root, ".cursor/rules/mega-discipline.mdc", cursorDisciplineTemplate());

    // First write to bring everything into sync.
    await runOnce({
      repoRoot: root,
      check: false,
      write: true,
      fix: false,
      list: false,
      stdout: () => undefined,
      stderr: () => undefined,
    });

    // Tamper with one consumer.
    const agents = await readFile(join(root, "AGENTS.md"), "utf8");
    await writeFile(join(root, "AGENTS.md"), agents.replace("body of mission.md", "TAMPERED"));

    const c = newCapture();
    const r = await runOnce({
      repoRoot: root,
      check: true,
      write: false,
      fix: false,
      list: false,
      stdout: (l) => c.out.push(l),
      stderr: (l) => c.err.push(l),
    });
    expect(r.exitCode).toBe(1);
    const stdoutJoined = c.out.join("\n");
    expect(stdoutJoined).toContain("AGENTS.md");
    expect(stdoutJoined).toContain("-TAMPERED");
  });
});

function blockSentinel(id: string, source: string): string {
  return [
    `<!-- conventions:start id="${id}" source="${source}" -->`,
    "PLACEHOLDER",
    `<!-- conventions:end id="${id}" -->`,
  ].join("\n");
}

function claudeTemplate(): string {
  return [
    "# CLAUDE.md (test)",
    "",
    "## §0 Wiki-First",
    blockSentinel("wiki-first", "wiki-first.md"),
    "## §1 Mission",
    blockSentinel("mission", "mission.md"),
    "## §2 Repo Layout",
    blockSentinel("repo-layout", "repo-layout.md"),
    "## §3 Stack",
    blockSentinel("stack-and-commands", "stack-and-commands.md"),
    "## §4 Process",
    blockSentinel("process-discipline", "process-discipline.md"),
    "## §5 Skill Routing",
    blockSentinel("skill-routing", "skill-routing.md"),
    "## §6 Agent Routing",
    blockSentinel("agent-routing", "agent-routing.md"),
    "## §7 Dogfood",
    blockSentinel("multi-agent-dogfood", "multi-agent-dogfood.md"),
    "## §8 Code",
    blockSentinel("code-conventions", "code-conventions.md"),
    "## §9 DoD",
    blockSentinel("definition-of-done", "definition-of-done.md"),
    "## §10 Git",
    blockSentinel("git-and-commits", "git-and-commits.md"),
    "## §11 Language",
    blockSentinel("language", "language.md"),
    "## §12 Risk",
    blockSentinel("risk-modes", "risk-modes.md"),
    "## §13 Anti",
    blockSentinel("anti-patterns", "anti-patterns.md"),
    "",
  ].join("\n");
}

function agentsTemplate(): string {
  return [
    "# AGENTS.md (test)",
    "",
    "## Wiki-First",
    blockSentinel("wiki-first", "wiki-first.md"),
    "## Mission",
    blockSentinel("mission", "mission.md"),
    "## Stack",
    blockSentinel("stack-and-commands", "stack-and-commands.md"),
    "## Process",
    blockSentinel("process-discipline", "process-discipline.md"),
    "## Code",
    blockSentinel("code-conventions", "code-conventions.md"),
    "## Git",
    blockSentinel("git-and-commits", "git-and-commits.md"),
    "## Risk",
    blockSentinel("risk-modes", "risk-modes.md"),
    "## Dogfood",
    blockSentinel("multi-agent-dogfood", "multi-agent-dogfood.md"),
    "## Anti",
    blockSentinel("anti-patterns", "anti-patterns.md"),
    "",
  ].join("\n");
}

function cursorContextTemplate(): string {
  return [
    "---",
    "description: ctx",
    "---",
    blockSentinel("mission", "mission.md"),
    blockSentinel("repo-layout", "repo-layout.md"),
    blockSentinel("stack-and-commands", "stack-and-commands.md"),
    blockSentinel("multi-agent-dogfood", "multi-agent-dogfood.md"),
    "",
  ].join("\n");
}

function cursorConventionsTemplate(): string {
  return [
    "---",
    "description: conv",
    "---",
    blockSentinel("code-conventions", "code-conventions.md"),
    blockSentinel("language", "language.md"),
    blockSentinel("git-and-commits", "git-and-commits.md"),
    blockSentinel("anti-patterns", "anti-patterns.md"),
    "",
  ].join("\n");
}

function cursorDisciplineTemplate(): string {
  return [
    "---",
    "description: disc",
    "---",
    blockSentinel("process-discipline", "process-discipline.md"),
    blockSentinel("definition-of-done", "definition-of-done.md"),
    blockSentinel("risk-modes", "risk-modes.md"),
    blockSentinel("skill-routing", "skill-routing.md"),
    "",
  ].join("\n");
}
