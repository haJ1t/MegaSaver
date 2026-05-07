import { describe, expect, it } from "vitest";
import { ConnectorError } from "../src/errors.js";
import { parseBlock } from "../src/parse.js";

describe("parseBlock", () => {
  it("returns no block for content without sentinels", () => {
    expect(parseBlock("hello\nworld\n")).toEqual({
      before: "hello\nworld\n",
      block: null,
      after: "",
    });
  });

  it("extracts a single block with surrounding content", () => {
    const content = "intro\n<!-- MEGA SAVER:BEGIN -->\nbody\n<!-- MEGA SAVER:END -->\nafter\n";
    const parsed = parseBlock(content);
    expect(parsed.before).toBe("intro\n");
    expect(parsed.block).toContain("MEGA SAVER:BEGIN");
    expect(parsed.block).toContain("MEGA SAVER:END");
    expect(parsed.after).toBe("after\n");
  });

  it("rejects two begin sentinels", () => {
    const content =
      "<!-- MEGA SAVER:BEGIN -->\n<!-- MEGA SAVER:BEGIN -->\n<!-- MEGA SAVER:END -->\n";
    expect(() => parseBlock(content)).toThrow(ConnectorError);
  });

  it("rejects begin-only sentinel", () => {
    expect(() => parseBlock("<!-- MEGA SAVER:BEGIN -->\n")).toThrow(ConnectorError);
  });

  it("rejects end-only sentinel", () => {
    expect(() => parseBlock("<!-- MEGA SAVER:END -->\n")).toThrow(ConnectorError);
  });

  it("rejects end before begin", () => {
    expect(() =>
      parseBlock("<!-- MEGA SAVER:END -->\n<!-- MEGA SAVER:BEGIN -->\n"),
    ).toThrow(ConnectorError);
  });
});
