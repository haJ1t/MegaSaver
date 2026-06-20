import type { Dirent } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { type WikiInput, parseWikiPage } from "@megasaver/memory-graph";

// Only these six folders are in-scope wiki folders; raw/ and archive/ are
// intentionally excluded — raw/ is immutable and archive/ is stale content.
const WIKI_FOLDERS = ["entities", "concepts", "decisions", "syntheses", "workflows", "sources"];

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

// Walk the project's wiki/ directory and return parsed WikiInput entries.
// Path confinement: top-level folders and in-walk entries are skipped when they are
// symlinks (Dirent.isSymbolicLink); a symlinked target could escape the wiki tree.
export async function readWikiPages(rootPath: string): Promise<WikiInput[]> {
  const wikiRoot = resolve(join(rootPath, "wiki"));
  const results: WikiInput[] = [];

  async function walkDir(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      // ENOENT alone is a benign skip (folder vanished between lstat and readdir);
      // EACCES/EIO/EMFILE are real failures that must surface, not become an empty wiki.
      if (isNodeError(e) && e.code === "ENOENT") return;
      throw e;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      // Skip symlinks — a symlinked target could escape the wiki tree.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walkDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        let content: string;
        try {
          content = await readFile(fullPath, "utf8");
        } catch (e) {
          // The file vanished between readdir and read → skip; EACCES/EIO must surface.
          if (isNodeError(e) && e.code === "ENOENT") continue;
          throw e;
        }
        // Normalize to POSIX separators: the wiki node id must be /-separated on
        // every OS so it matches /-shaped [[link]] targets and (source:) citations.
        const relPath = relative(wikiRoot, fullPath).split(sep).join("/");
        results.push(parseWikiPage(relPath, content));
      }
    }
  }

  for (const folder of WIKI_FOLDERS) {
    const folderPath = join(wikiRoot, folder);
    // Skip top-level folder if it is a symlink — mirrors the in-walk isSymbolicLink() skip.
    let st: Awaited<ReturnType<typeof lstat>>;
    try {
      st = await lstat(folderPath);
    } catch (e) {
      // A wiki folder that does not exist is a legitimate skip; EACCES/EIO must surface.
      if (isNodeError(e) && e.code === "ENOENT") continue;
      throw e;
    }
    if (st.isSymbolicLink()) continue;
    await walkDir(folderPath);
  }

  return results;
}
