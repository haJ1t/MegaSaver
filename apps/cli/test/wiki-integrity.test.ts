import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// wiki/ is the project's only cross-session, cross-agent memory channel
// (CLAUDE.md §0), and pages are never deleted, only archived (wiki/CLAUDE.md
// hard rule 6) — so an empty tracked page is always an accident. Merge 5a13a8c2
// resolved a conflict in the append-only wiki/log.md to an empty file and
// silently dropped 4258 lines; nothing in `pnpm verify` noticed.
const wikiRoot = fileURLToPath(new URL("../../../wiki/", import.meta.url));

function wikiPages(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...wikiPages(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".md")) found.push(fullPath);
  }
  return found;
}

describe("wiki integrity", () => {
  it("has no empty markdown page", () => {
    const empty = wikiPages(wikiRoot)
      .filter((page) => readFileSync(page, "utf8").trim() === "")
      .map((page) => `wiki/${relative(wikiRoot, page)}`);
    expect(empty).toEqual([]);
  });

  it("keeps the append-only log's timestamped entries", () => {
    const log = readFileSync(join(wikiRoot, "log.md"), "utf8");
    // 185 entries live at the time of writing; the floor only has to survive a
    // future archive rotation while still failing on a wipe or a truncation.
    expect(log.match(/^## \[/gm)?.length ?? 0).toBeGreaterThan(50);
  });
});
