import { describe, expect, it } from "vitest";
import type { ExtractedBlock } from "../src/code-block.js";
import { extractPy } from "../src/extract/extract-py.js";

const PY_SOURCE = `import os
from typing import Optional


def validate_token(token: str) -> bool:
    return bool(token)


async def fetch_user(uid: int):
    helper = inner(uid)
    return helper


class AuthService:
    def check(self) -> bool:
        return validate_token("x")

    def other(self):
        return 2


CONST_AT_COL0 = 1
`;

function byName(blocks: ExtractedBlock[], name: string): ExtractedBlock | undefined {
  return blocks.find((b) => b.name === name);
}

describe("extractPy", () => {
  const blocks = extractPy("src/auth.py", PY_SOURCE);

  it("extracts a top-level def as a function block", () => {
    const fn = byName(blocks, "validate_token");
    expect(fn?.blockType).toBe("function");
    expect((fn?.startLine ?? 0) > 0).toBe(true);
    expect((fn?.endLine ?? 0) >= (fn?.startLine ?? 0)).toBe(true);
    expect(fn?.imports).toEqual([]);
    expect(fn?.exports).toEqual([]);
    expect(fn?.calls).toEqual([]);
    expect(fn?.calledBy).toEqual([]);
  });

  it("extracts an async def as a function block", () => {
    expect(byName(blocks, "fetch_user")?.blockType).toBe("function");
  });

  it("extracts a top-level class as a class block", () => {
    expect(byName(blocks, "AuthService")?.blockType).toBe("class");
  });

  it("ends a block at the line before the next column-0 construct", () => {
    const fn = byName(blocks, "validate_token");
    const next = byName(blocks, "fetch_user");
    expect((fn?.endLine ?? 0) < (next?.startLine ?? 0)).toBe(true);
  });

  it("does NOT emit nested methods as their own blocks (top-level only)", () => {
    expect(byName(blocks, "check")).toBeUndefined();
    expect(byName(blocks, "other")).toBeUndefined();
  });

  it("the class block spans its nested methods (indentation end)", () => {
    const cls = byName(blocks, "AuthService");
    expect((cls?.endLine ?? 0) - (cls?.startLine ?? 0) >= 4).toBe(true);
  });

  it("keywords derive from the name, contentHash is stable", () => {
    expect(byName(blocks, "validate_token")?.keywords).toEqual(
      expect.arrayContaining(["validate", "token"]),
    );
    const again = extractPy("src/auth.py", PY_SOURCE);
    expect(byName(again, "validate_token")?.contentHash).toBe(
      byName(blocks, "validate_token")?.contentHash,
    );
    expect(byName(blocks, "validate_token")?.contentHash).not.toBe(
      byName(blocks, "AuthService")?.contentHash,
    );
  });

  it("returns [] for a file with no top-level def/class", () => {
    expect(extractPy("src/empty.py", "x = 1\ny = 2\n")).toEqual([]);
    expect(extractPy("src/blank.py", "")).toEqual([]);
  });

  it("never throws on a never-closing / odd file (clamps to EOF)", () => {
    expect(() => extractPy("src/x.py", "def open_only(:\n    pass")).not.toThrow();
    const b = extractPy("src/x.py", "def lonely():\n    return 1");
    expect(b[0]?.endLine).toBe(2);
  });
});
