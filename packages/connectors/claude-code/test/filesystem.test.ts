import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  ClaudeCodeConnectorError,
  MEGA_SAVER_BLOCK_START,
  readClaudeMd,
  syncClaudeMdContext,
  writeClaudeMd,
} from "../src/index.js";
import { project, projectMemory, session, sessionMemory } from "./fixtures.js";

const roots: string[] = [];
const context = {
  agentId: "claude-code" as const,
  project,
  session,
  memoryEntries: [projectMemory, sessionMemory],
};

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

describe("CLAUDE.md filesystem helpers", () => {
  test("returns null when root CLAUDE.md is missing", async () => {
    const projectRoot = await tempRoot();

    await expect(readClaudeMd(projectRoot)).resolves.toBeNull();
  });

  test("rejects relative project roots with a typed error", async () => {
    await expectConnectorCode(readClaudeMd("relative-root"), "project_root_invalid");
  });

  test("rejects missing project roots with a typed error", async () => {
    const parent = await tempRoot();
    const projectRoot = join(parent, "missing-root");

    await expectConnectorCode(readClaudeMd(projectRoot), "project_root_invalid");
  });

  test("rejects file-shaped project roots with a typed error", async () => {
    const parent = await tempRoot();
    const projectRoot = join(parent, "not-a-directory");
    await writeFile(projectRoot, "file");

    await expectConnectorCode(readClaudeMd(projectRoot), "project_root_invalid");
  });

  test("writes only the root CLAUDE.md file", async () => {
    const projectRoot = await tempRoot();

    await writeClaudeMd({ projectRoot, content: "# Human\n" });

    await expect(readFile(join(projectRoot, "CLAUDE.md"), "utf8")).resolves.toBe("# Human\n");
  });

  test("preserves human content and writes managed context during sync", async () => {
    const projectRoot = await tempRoot();
    await writeFile(join(projectRoot, "CLAUDE.md"), "# Human Notes\n");

    const written = await syncClaudeMdContext({ projectRoot, context });

    expect(written).toContain("# Human Notes\n\n");
    expect(written).toContain(MEGA_SAVER_BLOCK_START);
    expect(written).toContain("Project: Mega Saver");
    await expect(readFile(join(projectRoot, "CLAUDE.md"), "utf8")).resolves.toBe(written);
  });

  test("does not touch nested .claude/CLAUDE.md when syncing root CLAUDE.md", async () => {
    const projectRoot = await tempRoot();
    const nestedDir = join(projectRoot, ".claude");
    const nestedPath = join(nestedDir, "CLAUDE.md");
    await mkdir(nestedDir);
    await writeFile(nestedPath, "# Nested\n");
    await writeFile(join(projectRoot, "CLAUDE.md"), "# Root\n");

    await syncClaudeMdContext({ projectRoot, context });

    await expect(readFile(nestedPath, "utf8")).resolves.toBe("# Nested\n");
  });

  test("throws a typed read error when root CLAUDE.md is directory-shaped", async () => {
    const projectRoot = await tempRoot();
    await mkdir(join(projectRoot, "CLAUDE.md"));

    await expectConnectorCode(readClaudeMd(projectRoot), "claude_md_read_failed");
  });

  test("throws a typed write error when root CLAUDE.md is directory-shaped", async () => {
    const projectRoot = await tempRoot();
    await mkdir(join(projectRoot, "CLAUDE.md"));

    await expectConnectorCode(
      writeClaudeMd({ projectRoot, content: "# Human\n" }),
      "claude_md_write_failed",
    );
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "megasaver-claude-code-"));
  roots.push(root);
  return root;
}

async function expectConnectorCode(
  promise: Promise<unknown>,
  code: ClaudeCodeConnectorError["code"],
): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(ClaudeCodeConnectorError);
  await expect(promise).rejects.toMatchObject({ code });
}
