import { describe, expect, it } from "vitest";
import type { ExtractedBlock } from "../src/code-block.js";
import { extractRs } from "../src/extract/extract-rs.js";

const RS_SOURCE = `use std::fmt;

pub fn validate(token: &str) -> bool {
    !token.is_empty()
}

async fn fetch_user(uid: u64) -> User {
    inner(uid)
}

pub struct Auth {
    ttl: u32,
}

struct Unit;

enum State {
    On,
    Off,
}

trait Checkable {
    fn check(&self) -> bool;
}

impl Auth {
    fn check(&self) -> bool {
        validate("x")
    }
}
`;

function byName(blocks: ExtractedBlock[], name: string): ExtractedBlock | undefined {
  return blocks.find((b) => b.name === name);
}

describe("extractRs", () => {
  const blocks = extractRs("src/auth.rs", RS_SOURCE);

  it("extracts a pub fn as a function block, brace-balanced", () => {
    const fn = byName(blocks, "validate");
    expect(fn?.blockType).toBe("function");
    expect((fn?.endLine ?? 0) - (fn?.startLine ?? 0)).toBe(2);
    expect(fn?.imports).toEqual([]);
  });

  it("extracts an async fn as a function block", () => {
    expect(byName(blocks, "fetch_user")?.blockType).toBe("function");
  });

  it("extracts struct / enum / trait as class blocks", () => {
    expect(byName(blocks, "Auth")?.blockType).toBe("class");
    expect(byName(blocks, "State")?.blockType).toBe("class");
    expect(byName(blocks, "Checkable")?.blockType).toBe("class");
  });

  it("treats a unit struct (struct Unit;) as a 1-line class span", () => {
    const u = byName(blocks, "Unit");
    expect(u?.blockType).toBe("class");
    expect(u?.startLine).toBe(u?.endLine);
  });

  it("extracts impl Auth as a class block (TYPE_RE captures the ident)", () => {
    const implAndStruct = blocks.filter((b) => b.name === "Auth" && b.blockType === "class");
    expect(implAndStruct.length).toBe(2);
  });

  it("emits no nested fn blocks (top-level only)", () => {
    expect(blocks.filter((b) => b.name === "check").length).toBe(0);
  });

  it("returns [] for a file with no top-level decl", () => {
    expect(extractRs("src/x.rs", "use std::io;\n")).toEqual([]);
    expect(extractRs("src/x.rs", "")).toEqual([]);
  });

  it("never throws and clamps a never-closing brace to EOF", () => {
    const b = extractRs("src/x.rs", "fn open() {\n    1");
    expect(b[0]?.endLine).toBe(2);
    expect(() => extractRs("src/x.rs", "fn {{{")).not.toThrow();
  });

  it("keywords + stable contentHash", () => {
    expect(byName(blocks, "fetch_user")?.keywords).toEqual(
      expect.arrayContaining(["fetch", "user"]),
    );
    const again = extractRs("src/auth.rs", RS_SOURCE);
    expect(byName(again, "validate")?.contentHash).toBe(byName(blocks, "validate")?.contentHash);
  });
});
