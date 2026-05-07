import { randomUUID } from "node:crypto";
import { chmod, lstat, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { ConnectorContext } from "./context.js";
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
  try {
    const st = await lstat(input.absPath);
    if (st.isSymbolicLink()) {
      throw new ConnectorError(
        "file_write_failed",
        "Target file is a symbolic link; refuse to replace.",
        { filePath: input.absPath },
      );
    }
  } catch (error) {
    if (error instanceof ConnectorError) throw error;
    if (!isNodeErrorWithCode(error, "ENOENT")) {
      throw new ConnectorError("file_write_failed", "Failed to stat target file.", {
        cause: error,
        filePath: input.absPath,
      });
    }
  }

  let existingMode: number | undefined;
  try {
    const st = await stat(input.absPath);
    existingMode = st.mode & 0o777;
  } catch {
    // ENOENT — new file, skip mode preservation
  }

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

  if (existingMode !== undefined) {
    await chmod(input.absPath, existingMode);
  }
}

export async function syncTargetBlock(input: SyncTargetBlockInput): Promise<string> {
  const existing = (await readTargetFile(input.absPath)) ?? "";
  const content = upsertBlock({ existingContent: existing, context: input.context });
  await writeTargetFile({ absPath: input.absPath, content });
  return content;
}

export async function assertProjectRoot(projectRoot: string): Promise<void> {
  if (!isAbsolute(projectRoot)) {
    throw new ConnectorError(
      "target_path_invalid",
      "Project root must be an absolute path to an existing directory.",
      { filePath: projectRoot },
    );
  }
  try {
    const projectRootStat = await stat(projectRoot);
    if (!projectRootStat.isDirectory()) {
      throw new ConnectorError(
        "target_path_invalid",
        "Project root must be an absolute path to an existing directory.",
        { filePath: projectRoot },
      );
    }
  } catch (error) {
    if (error instanceof ConnectorError) throw error;
    throw new ConnectorError(
      "target_path_invalid",
      "Project root must be an absolute path to an existing directory.",
      { cause: error, filePath: projectRoot },
    );
  }
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code
  );
}
