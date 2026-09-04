import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const COMMANDS = join(import.meta.dirname, "..", "..", "src", "commands");

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...listTs(p));
    else if (f.endsWith(".ts")) out.push(p);
  }
  return out;
}

function userThrows(src: string): string[] {
  const out: string[] = [];
  const re = /throw new Error\(("([^"]+)"|'([^']+)'|`([^`]+)`)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const msg = (m[2] ?? m[3] ?? m[4]) as string;
    if (/^(error|mega proxy):/.test(msg)) continue;
    if (/\(stub/.test(msg)) continue;
    if (/^[a-z]+ \| /.test(msg)) continue;
    if (/^[a-z]+$/.test(msg)) continue;
    // Value-echo exception (dictionary section 4): interpolated messages pin
    // uppercase-start only; trailing period would corrupt the echoed token.
    out.push(/\$\{/.test(msg) ? "UPPER:" + msg : msg);
  }
  return out;
}

describe("user-facing command messages", () => {
  it("start uppercase and end with a period", () => {
    const bad: string[] = [];
    for (const f of listTs(COMMANDS)) {
      const src = readFileSync(f, "utf8");
      for (const msg of userThrows(src)) {
        if (msg.startsWith("UPPER:")) {
          const inner = msg.slice(6);
          if (!/^[A-Z]/.test(inner)) bad.push(f.slice(COMMANDS.length + 1) + ":" + inner);
        } else if (!/^[A-Z]/.test(msg) || !/\.$/.test(msg)) {
          bad.push(f.slice(COMMANDS.length + 1) + ":" + msg);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
