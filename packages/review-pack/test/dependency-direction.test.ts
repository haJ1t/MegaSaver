import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function getSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...getSourceFiles(full));
    } else if (full.endsWith(".ts")) {
      results.push(full);
    }
  }
  return results;
}

describe("review-pack dependency direction", () => {
  it("does not import @megasaver/core and only lazily imports indexer", () => {
    const srcDir = join(__dirname, "../src");
    const files = getSourceFiles(srcDir);
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      expect(content).not.toContain("@megasaver/core");
      // Check that static import of @megasaver/indexer does not exist (only dynamic import allowed)
      const staticIndexerImport = /^import\s+.*\s+from\s+["']@megasaver\/indexer["']/m;
      expect(staticIndexerImport.test(content)).toBe(false);
    }
  });
});
