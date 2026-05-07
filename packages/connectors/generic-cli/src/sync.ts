import { join } from "node:path";
import {
  assertProjectRoot,
  type ConnectorContext,
  readTargetFile,
  syncTargetBlock,
  writeTargetFile,
} from "@megasaver/connectors-shared";
import { assertGenericCliContext } from "./context.js";
import { wrapSharedConnectorError } from "./errors.js";
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

export async function syncGenericCliTarget(input: SyncGenericCliTargetInput): Promise<string> {
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

export async function writeGenericCliTarget(input: WriteGenericCliTargetInput): Promise<void> {
  const filePath = await targetPath(input.projectRoot, input.target);
  try {
    await writeTargetFile({ absPath: filePath, content: input.content });
  } catch (error) {
    wrapSharedConnectorError(error, filePath);
  }
}

async function targetPath(projectRoot: string, target: ConnectorTarget): Promise<string> {
  try {
    await assertProjectRoot(projectRoot);
  } catch (error) {
    wrapSharedConnectorError(error, projectRoot);
  }
  return join(projectRoot, target.relativePath);
}
