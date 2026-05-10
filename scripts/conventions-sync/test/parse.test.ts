import { describe, expect, it } from "vitest";
import { ConventionsError } from "../src/errors.ts";
import { parseFile } from "../src/parse.ts";

describe("parseFile", () => {
  it("returns no blocks for plain markdown", () => {
    const r = parseFile("# Heading\n\nbody\n");
    expect(r.blocks).toEqual([]);
  });

  it("extracts one block with source attribute", () => {
    const text = [
      "preface",
      '<!-- conventions:start id="mission" source="mission.md" -->',
      "managed body",
      "more body",
      '<!-- conventions:end id="mission" -->',
      "trailer",
    ].join("\n");
    const r = parseFile(text);
    expect(r.blocks).toHaveLength(1);
    const block = r.blocks[0];
    expect(block?.id).toBe("mission");
    expect(block?.source).toBe("mission.md");
    expect(block?.fragment).toBeUndefined();
    expect(block?.body).toBe("managed body\nmore body");
    expect(block?.startLine).toBe(1);
    expect(block?.endLine).toBe(4);
  });

  it("extracts a block with fragment attribute", () => {
    const text = [
      '<!-- conventions:start id="x" source="risk-modes.md" fragment="HIGH" -->',
      "body",
      '<!-- conventions:end id="x" -->',
    ].join("\n");
    const r = parseFile(text);
    expect(r.blocks[0]?.fragment).toBe("HIGH");
  });

  it("rejects an unclosed block", () => {
    const text = ['<!-- conventions:start id="x" source="a.md" -->', "body without end"].join("\n");
    expect(() => parseFile(text)).toThrow(ConventionsError);
    try {
      parseFile(text);
    } catch (err) {
      expect((err as ConventionsError).code).toBe("block-unclosed");
    }
  });

  it("rejects an orphan end sentinel", () => {
    const text = '<!-- conventions:end id="x" -->';
    try {
      parseFile(text);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConventionsError);
      expect((err as ConventionsError).code).toBe("block-orphan-end");
    }
  });

  it("rejects mismatched end id", () => {
    const text = [
      '<!-- conventions:start id="a" source="x.md" -->',
      "body",
      '<!-- conventions:end id="b" -->',
    ].join("\n");
    try {
      parseFile(text);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ConventionsError).code).toBe("block-orphan-end");
    }
  });

  it("rejects duplicate ids in the same file", () => {
    const text = [
      '<!-- conventions:start id="x" source="a.md" -->',
      "first",
      '<!-- conventions:end id="x" -->',
      '<!-- conventions:start id="x" source="a.md" -->',
      "second",
      '<!-- conventions:end id="x" -->',
    ].join("\n");
    try {
      parseFile(text);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ConventionsError).code).toBe("block-duplicate-id");
    }
  });

  it("rejects nested start sentinels", () => {
    const text = [
      '<!-- conventions:start id="outer" source="a.md" -->',
      '<!-- conventions:start id="inner" source="b.md" -->',
      "body",
      '<!-- conventions:end id="inner" -->',
      '<!-- conventions:end id="outer" -->',
    ].join("\n");
    try {
      parseFile(text);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ConventionsError).code).toBe("block-nested");
    }
  });
});
