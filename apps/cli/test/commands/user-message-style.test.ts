import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..", "..", "src", "commands");

function userThrows(src: string): string[] {
  const out: string[] = [];
  const re = /throw new Error\("([^"]+)"\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const msg = m[1] as string;
    if (/^(error|mega proxy):/.test(msg)) continue;
    if (/\(stub/.test(msg)) continue;
    if (/^[a-z]+ \| /.test(msg)) continue;
    if (/^[a-z]+$/.test(msg)) continue;
    out.push(msg);
  }
  return out;
}

const FILES = [
  "mesh/status.ts",
  "mesh/claims.ts",
  "mesh/events.ts",
  "mesh/ask.ts",
  "mesh/send.ts",
  "mesh/gc.ts",
  "mesh/answer.ts",
  "board/promote.ts",
  "board/resolve.ts",
  "board/list.ts",
  "board/post.ts",
  "resume/render.ts",
];

describe("user-facing command messages", () => {
  it("start uppercase and end with a period", () => {
    const bad: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(join(SRC, f), "utf8");
      for (const msg of userThrows(src)) {
        if (!/^[A-Z]/.test(msg) || !/\.$/.test(msg)) bad.push(f + ":" + msg);
      }
    }
    expect(bad).toEqual([]);
  });
});
