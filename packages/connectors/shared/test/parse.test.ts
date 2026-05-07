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
    expect(() => parseBlock("<!-- MEGA SAVER:END -->\n<!-- MEGA SAVER:BEGIN -->\n")).toThrow(
      ConnectorError,
    );
  });

  it("block_conflict message identifies multi-begin line numbers", () => {
    const content =
      "<!-- MEGA SAVER:BEGIN -->\nx\n<!-- MEGA SAVER:BEGIN -->\n<!-- MEGA SAVER:END -->\n";
    const err = (() => {
      try {
        parseBlock(content);
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ConnectorError);
    expect((err as ConnectorError).message).toContain("line 1");
    expect((err as ConnectorError).message).toContain("line 3");
  });

  it("block_conflict message identifies multi-end line numbers", () => {
    const content =
      "<!-- MEGA SAVER:BEGIN -->\n<!-- MEGA SAVER:END -->\nx\n<!-- MEGA SAVER:END -->\n";
    const err = (() => {
      try {
        parseBlock(content);
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ConnectorError);
    expect((err as ConnectorError).message).toContain("line 2");
    expect((err as ConnectorError).message).toContain("line 4");
  });

  it("block_conflict message identifies begin-only line number", () => {
    const err = (() => {
      try {
        parseBlock("prefix\n<!-- MEGA SAVER:BEGIN -->\n");
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ConnectorError);
    expect((err as ConnectorError).message).toContain("line 2");
    expect((err as ConnectorError).message).toContain("no end sentinel");
  });

  it("block_conflict message identifies end-only line number", () => {
    const err = (() => {
      try {
        parseBlock("prefix\n<!-- MEGA SAVER:END -->\n");
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ConnectorError);
    expect((err as ConnectorError).message).toContain("line 2");
    expect((err as ConnectorError).message).toContain("no begin sentinel");
  });

  it("block_conflict message identifies end-before-begin line numbers", () => {
    const err = (() => {
      try {
        parseBlock("<!-- MEGA SAVER:END -->\n<!-- MEGA SAVER:BEGIN -->\n");
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ConnectorError);
    expect((err as ConnectorError).message).toContain("line 1");
    expect((err as ConnectorError).message).toContain("line 2");
  });
});
