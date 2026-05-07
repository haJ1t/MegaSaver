import { join } from "node:path";
import {
  assertProjectRoot,
  readTargetFile,
  syncTargetBlock,
  writeTargetFile,
} from "@megasaver/connectors-shared";
import { CLAUDE_MD_FILE } from "./constants.js";
import type { ClaudeCodeContext } from "./context.js";
import { wrapSharedConnectorError } from "./errors.js";

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
  try {
    await assertProjectRoot(projectRoot);
  } catch (error) {
    wrapSharedConnectorError(error, projectRoot);
  }
  return join(projectRoot, CLAUDE_MD_FILE);
}
