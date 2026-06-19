import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { type WikiInput, parseWikiPage } from "@megasaver/memory-graph";

// Only these six folders are in-scope wiki folders; raw/ and archive/ are
// intentionally excluded — raw/ is immutable and archive/ is stale content.
const WIKI_FOLDERS = ["entities", "concepts", "decisions", "syntheses", "workflows", "sources"];

// Walk the project's wiki/ directory and return parsed WikiInput entries.
// Path confinement: top-level folders are lstat'd and skipped if they are symlinks;
// entries inside each walk are skipped via Dirent.isSymbolicLink(); the resolved-path
// startsWith check guards against any remaining ../ traversal.
export async function readWikiPages(rootPath: string): Promise<WikiInput[]> {
  const wikiRoot = resolve(join(rootPath, "wiki"));
  const confinementPrefix = wikiRoot + sep;
  const results: WikiInput[] = [];

  async function walkDir(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
    if (entries === null) return;
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      // Skip symlinks — a symlinked target could escape the wiki tree.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walkDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        // Verify the resolved path stays within wiki root before reading.
        const realPath = resolve(fullPath);
        if (!realPath.startsWith(confinementPrefix)) continue;
        let content: string;
        try {
          content = await readFile(fullPath, "utf8");
        } catch {
          continue;
        }
        // Normalize to POSIX separators: the wiki node id must be /-separated on
        // every OS so it matches /-shaped [[link]] targets and (source:) citations.
        const relPath = relative(wikiRoot, realPath).split(sep).join("/");
        results.push(parseWikiPage(relPath, content));
      }
    }
  }

  for (const folder of WIKI_FOLDERS) {
    const folderPath = join(wikiRoot, folder);
    // Skip top-level folder if it is a symlink — mirrors the in-walk isSymbolicLink() skip.
    // lstat throws on ENOENT (folder absent) → treat as skip, same as readdir catching null.
    const st = await lstat(folderPath).catch(() => null);
    if (st === null || st.isSymbolicLink()) continue;
    await walkDir(folderPath);
  }

  return results;
}
