import { describe, expect, it } from "vitest";
import { parseFile } from "../src/parse.ts";
import { applyBlocks, renderBlock } from "../src/render.ts";

describe("renderBlock", () => {
  it("wraps body in sentinels", () => {
    const out = renderBlock({ id: "x", source: "a.md" }, "hello\nworld");
    expect(out).toBe(
      [
        '<!-- conventions:start id="x" source="a.md" -->',
        "hello",
        "world",
        '<!-- conventions:end id="x" -->',
      ].join("\n"),
    );
  });

  it("includes fragment attribute when provided", () => {
    const out = renderBlock({ id: "y", source: "r.md", fragment: "HIGH" }, "body");
    expect(out).toContain('fragment="HIGH"');
  });

  it("normalizes wrapping whitespace in body", () => {
    const out = renderBlock({ id: "x", source: "a.md" }, "\n\nbody\n\n");
    expect(out).toBe(
      [
        '<!-- conventions:start id="x" source="a.md" -->',
        "body",
        '<!-- conventions:end id="x" -->',
      ].join("\n"),
    );
  });
});

describe("applyBlocks", () => {
  it("replaces a block body in place and preserves surrounding content", () => {
    const text = [
      "preamble line 1",
      "preamble line 2",
      '<!-- conventions:start id="x" source="a.md" -->',
      "stale body",
      '<!-- conventions:end id="x" -->',
      "tail line",
    ].join("\n");
    const parsed = parseFile(text);
    const renders = new Map([["x", renderBlock({ id: "x", source: "a.md" }, "fresh body")]]);
    const out = applyBlocks(parsed, renders);
    expect(out).toBe(
      [
        "preamble line 1",
        "preamble line 2",
        '<!-- conventions:start id="x" source="a.md" -->',
        "fresh body",
        '<!-- conventions:end id="x" -->',
        "tail line",
      ].join("\n"),
    );
  });

  it("replaces multiple blocks without shifting outside content", () => {
    const text = [
      "a",
      '<!-- conventions:start id="one" source="a.md" -->',
      "old one",
      '<!-- conventions:end id="one" -->',
      "middle",
      '<!-- conventions:start id="two" source="b.md" -->',
      "old two",
      '<!-- conventions:end id="two" -->',
      "tail",
    ].join("\n");
    const parsed = parseFile(text);
    const renders = new Map([
      ["one", renderBlock({ id: "one", source: "a.md" }, "new one")],
      ["two", renderBlock({ id: "two", source: "b.md" }, "new two")],
    ]);
    const out = applyBlocks(parsed, renders);
    expect(out).toBe(
      [
        "a",
        '<!-- conventions:start id="one" source="a.md" -->',
        "new one",
        '<!-- conventions:end id="one" -->',
        "middle",
        '<!-- conventions:start id="two" source="b.md" -->',
        "new two",
        '<!-- conventions:end id="two" -->',
        "tail",
      ].join("\n"),
    );
  });
});
