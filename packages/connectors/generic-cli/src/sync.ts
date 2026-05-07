import {
  type ConnectorContext,
  readTargetFile,
  syncTargetBlock,
  writeTargetFile,
} from "@megasaver/connectors-shared";
import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { assertGenericCliContext } from "./context.js";
import { GenericCliConnectorError, wrapSharedConnectorError } from "./errors.js";
import type { ConnectorTarget } from "./targets.js";

interface SyncGenericCliTargetInput {
  projectRoot: string;
  target: ConnectorTarget;
  context: ConnectorContext;
}

interface ReadGenericCliTargetInput {
  projectRoot: string;
  target: ConnectorTarget;
}

interface WriteGenericCliTargetInput {
  projectRoot: string;
  target: ConnectorTarget;
  content: string;
}

export async function syncGenericCliTarget(
  input: SyncGenericCliTargetInput,
): Promise<string> {
  const filePath = await targetPath(input.projectRoot, input.target);
  const context = assertGenericCliContext(input.context, input.target);
  try {
    return await syncTargetBlock({ absPath: filePath, context });
  } catch (error) {
    wrapSharedConnectorError(error, filePath);
    return undefined as never;
  }
}

export async function readGenericCliTarget(
  input: ReadGenericCliTargetInput,
): Promise<string | null> {
  const filePath = await targetPath(input.projectRoot, input.target);
  try {
    return await readTargetFile(filePath);
  } catch (error) {
    wrapSharedConnectorError(error, filePath);
    return null;
  }
}

export async function writeGenericCliTarget(
  input: WriteGenericCliTargetInput,
): Promise<void> {
  const filePath = await targetPath(input.projectRoot, input.target);
  try {
    await writeTargetFile({ absPath: filePath, content: input.content });
  } catch (error) {
    wrapSharedConnectorError(error, filePath);
  }
}

async function targetPath(projectRoot: string, target: ConnectorTarget): Promise<string> {
  await assertProjectRoot(projectRoot);
  return join(projectRoot, target.relativePath);
}

async function assertProjectRoot(projectRoot: string): Promise<void> {
  if (!isAbsolute(projectRoot)) throwInvalidProjectRoot(projectRoot);
  try {
    const projectRootStat = await stat(projectRoot);
    if (!projectRootStat.isDirectory()) throwInvalidProjectRoot(projectRoot);
  } catch (error) {
    if (error instanceof GenericCliConnectorError) throw error;
    throwInvalidProjectRoot(projectRoot, error);
  }
}

function throwInvalidProjectRoot(projectRoot: string, cause?: unknown): never {
  throw new GenericCliConnectorError(
    "project_root_invalid",
    "Project root must be an absolute path to an existing directory.",
    { cause, filePath: projectRoot },
  );
}
