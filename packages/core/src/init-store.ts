import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const EMPTY_ARRAY_JSON = "[]";

async function writeIfMissing(path: string): Promise<void> {
  try {
    await writeFile(path, EMPTY_ARRAY_JSON, { flag: "wx" });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "EEXIST"
    ) {
      return;
    }
    throw error;
  }
}

export async function initStore(rootDir: string): Promise<void> {
  // The store root gates traversal into every session's captured output, so it
  // is owner-only. The chmod also repairs a root an older build left at 0755.
  await mkdir(rootDir, { recursive: true, mode: 0o700 });
  await chmod(rootDir, 0o700);
  await writeIfMissing(join(rootDir, "projects.json"));
  await writeIfMissing(join(rootDir, "sessions.json"));
}
