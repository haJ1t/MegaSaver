import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { readTargetFile, syncTargetBlock, writeTargetFile } from "@megasaver/connectors-shared";
import { CLAUDE_MD_FILE } from "./constants.js";
import type { ClaudeCodeContext } from "./context.js";
import { ClaudeCodeConnectorError, wrapSharedConnectorError } from "./errors.js";

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
    return await readTargetFile(filePath);
  } catch (error) {
    wrapSharedConnectorError(error, filePath);
    return null;
  }
}

export async function writeClaudeMd(input: WriteClaudeMdInput): Promise<void> {
  const filePath = await claudeMdPath(input.projectRoot);
  try {
    await writeTargetFile({ absPath: filePath, content: input.content });
  } catch (error) {
    wrapSharedConnectorError(error, filePath);
  }
}

export async function syncClaudeMdContext(input: SyncClaudeMdContextInput): Promise<string> {
  const filePath = await claudeMdPath(input.projectRoot);
  try {
    return await syncTargetBlock({ absPath: filePath, context: input.context });
  } catch (error) {
    wrapSharedConnectorError(error, filePath);
    return undefined as never;
  }
}

async function claudeMdPath(projectRoot: string): Promise<string> {
  await assertProjectRoot(projectRoot);
  return join(projectRoot, CLAUDE_MD_FILE);
}

async function assertProjectRoot(projectRoot: string): Promise<void> {
  if (!isAbsolute(projectRoot)) throwInvalidProjectRoot(projectRoot);
  try {
    const projectRootStat = await stat(projectRoot);
    if (!projectRootStat.isDirectory()) throwInvalidProjectRoot(projectRoot);
  } catch (error) {
    if (error instanceof ClaudeCodeConnectorError) throw error;
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
