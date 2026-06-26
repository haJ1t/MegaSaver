import { describe, expect, it } from "vitest";
import type { ExtractedBlock } from "../src/code-block.js";
import { extractGo } from "../src/extract/extract-go.js";

const GO_SOURCE = `package main

import "fmt"

func Validate(token string) bool {
	return len(token) > 0
}

type Auth struct {
	TTL int
}

func (a Auth) Check() bool {
	return Validate("x")
}

var (
	A = 1
	B = 2
)
`;

function byName(blocks: ExtractedBlock[], name: string): ExtractedBlock | undefined {
  return blocks.find((b) => b.name === name);
}

describe("extractGo", () => {
  const blocks = extractGo("src/main.go", GO_SOURCE);

  it("extracts a top-level func as a function block", () => {
    const fn = byName(blocks, "Validate");
    expect(fn?.blockType).toBe("function");
    expect(fn?.imports).toEqual([]);
    expect(fn?.exports).toEqual([]);
  });

  it("brace-balances the func body (end at the closing brace)", () => {
    const fn = byName(blocks, "Validate");
    expect((fn?.endLine ?? 0) - (fn?.startLine ?? 0)).toBe(2);
  });

  it("extracts a method (func with receiver) by its method name", () => {
    expect(byName(blocks, "Check")?.blockType).toBe("function");
  });

  it("extracts a type as a schema block, brace-balanced", () => {
    const t = byName(blocks, "Auth");
    expect(t?.blockType).toBe("schema");
    expect((t?.endLine ?? 0) > (t?.startLine ?? 0)).toBe(true);
  });

  it("extracts a grouped var ( ... ) block, paren-balanced, no single name", () => {
    const v = blocks.find((b) => b.blockType === "schema" && b.name === undefined);
    expect(v).toBeDefined();
    expect((v?.endLine ?? 0) > (v?.startLine ?? 0)).toBe(true);
  });

  it("emits no nested blocks (top-level only)", () => {
    expect(byName(blocks, "TTL")).toBeUndefined();
  });

  it("returns [] for a file with no top-level decl", () => {
    expect(extractGo("src/x.go", "package x\n")).toEqual([]);
    expect(extractGo("src/x.go", "")).toEqual([]);
  });

  it("never throws and clamps a never-closing brace to EOF", () => {
    const b = extractGo("src/x.go", "func Open() {\n\treturn");
    expect(b[0]?.endLine).toBe(2);
    expect(() => extractGo("src/x.go", "func {{{")).not.toThrow();
  });
});
