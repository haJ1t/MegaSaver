import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const EMPTY_ARRAY_JSON = "[]";

async function writeIfMissing(path: string): Promise<void> {
  try {
    await writeFile(path, EMPTY_ARRAY_JSON, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return;
    }
    throw error;
  }
}

export async function initStore(rootDir: string): Promise<void> {
  await mkdir(rootDir, { recursive: true });
  await writeIfMissing(join(rootDir, "projects.json"));
  await writeIfMissing(join(rootDir, "sessions.json"));
}
