import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A raw NUL byte in a source file makes git and @megasaver/indexer's scanRepo
// classify the file as binary and skip it — a silent recall gap (the file's
// code blocks never enter the index). For a NUL separator, write a unicode NUL
// escape sequence in the string literal, never a literal NUL byte. This guards
// every src/*.ts against regression.
const SRC = fileURLToPath(new URL("../src", import.meta.url));

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("source files contain no raw NUL bytes", () => {
  for (const f of tsFiles(SRC)) {
    it(`${f.slice(SRC.length + 1)} is NUL-free`, () => {
      expect(readFileSync(f).includes(0)).toBe(false);
    });
  }
});
