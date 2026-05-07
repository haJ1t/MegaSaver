import { randomUUID } from "node:crypto";
import { access, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { ClaudeCodeContext } from "./context.js";
import { ClaudeCodeConnectorError } from "./errors.js";
import { upsertMegaSaverBlock } from "./markdown.js";

const CLAUDE_MD_FILE_NAME = "CLAUDE.md";

interface WriteClaudeMdInput {
  projectRoot: string;
  content: string;
}

interface SyncClaudeMdContextInput {
  projectRoot: string;
  context: ClaudeCodeContext;
}

export async function readClaudeMd(projectRoot: string): Promise<string | null> {
  const filePath = await claudeMdPath(projectRoot);

  try {
    await access(filePath);
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return null;
    }

    throw new ClaudeCodeConnectorError("claude_md_read_failed", "Failed to access CLAUDE.md.", {
      cause: error,
      filePath,
    });
  }

  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    throw new ClaudeCodeConnectorError("claude_md_read_failed", "Failed to read CLAUDE.md.", {
      cause: error,
      filePath,
    });
  }
}

export async function writeClaudeMd(input: WriteClaudeMdInput): Promise<void> {
  const filePath = await claudeMdPath(input.projectRoot);
  const tempPath = join(input.projectRoot, `.CLAUDE.md.${randomUUID()}.tmp`);

  try {
    await writeFile(tempPath, input.content, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw new ClaudeCodeConnectorError("claude_md_write_failed", "Failed to write CLAUDE.md.", {
      cause: error,
      filePath,
    });
  }
}

export async function syncClaudeMdContext(input: SyncClaudeMdContextInput): Promise<string> {
  const existingContent = (await readClaudeMd(input.projectRoot)) ?? "";
  const content = upsertMegaSaverBlock({ existingContent, context: input.context });
  await writeClaudeMd({ projectRoot: input.projectRoot, content });

  return content;
}

async function claudeMdPath(projectRoot: string): Promise<string> {
  await assertProjectRoot(projectRoot);

  return join(projectRoot, CLAUDE_MD_FILE_NAME);
}

async function assertProjectRoot(projectRoot: string): Promise<void> {
  if (!isAbsolute(projectRoot)) {
    throwInvalidProjectRoot(projectRoot);
  }

  try {
    const projectRootStat = await stat(projectRoot);
    if (!projectRootStat.isDirectory()) {
      throwInvalidProjectRoot(projectRoot);
    }
  } catch (error) {
    if (error instanceof ClaudeCodeConnectorError) {
      throw error;
    }

    throwInvalidProjectRoot(projectRoot, error);
  }
}

function throwInvalidProjectRoot(projectRoot: string, cause?: unknown): never {
  throw new ClaudeCodeConnectorError(
    "project_root_invalid",
    "Project root must be an absolute path to an existing directory.",
    { cause, filePath: projectRoot },
  );
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
