import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type ConnectorContext } from "./context.js";
import { ConnectorError } from "./errors.js";
import { upsertBlock } from "./upsert.js";

interface WriteTargetFileInput {
  absPath: string;
  content: string;
}

interface SyncTargetBlockInput {
  absPath: string;
  context: ConnectorContext;
}

export async function readTargetFile(absPath: string): Promise<string | null> {
  try {
    return await readFile(absPath, "utf8");
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) return null;
    throw new ConnectorError("file_read_failed", "Failed to read target file.", {
      cause: error,
      filePath: absPath,
    });
  }
}

export async function writeTargetFile(input: WriteTargetFileInput): Promise<void> {
  const tempPath = join(dirname(input.absPath), `.${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, input.content, "utf8");
    await rename(tempPath, input.absPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw new ConnectorError("file_write_failed", "Failed to write target file.", {
      cause: error,
      filePath: input.absPath,
    });
  }
}

export async function syncTargetBlock(input: SyncTargetBlockInput): Promise<string> {
  const existing = (await readTargetFile(input.absPath)) ?? "";
  const content = upsertBlock({ existingContent: existing, context: input.context });
  await writeTargetFile({ absPath: input.absPath, content });
  return content;
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}
