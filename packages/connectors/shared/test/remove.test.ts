import { describe, expect, it } from "vitest";
import { removeBlock } from "../src/upsert.js";
import { upsertBlock } from "../src/upsert.js";
import { buildContext } from "./fixtures.js";

describe("removeBlock", () => {
  it("removes the block and preserves surrounding content", () => {
    const inserted = upsertBlock({
      existingContent: "intro\n",
      context: buildContext(),
    });
    const removed = removeBlock(inserted);
    expect(removed).toBe("intro\n");
  });

  it("removeBlock preserves CRLF dominant input", () => {
    const inserted = upsertBlock({
      existingContent: "intro\r\n",
      context: buildContext(),
    });
    const removed = removeBlock(inserted);
    expect(removed.includes("\r\n")).toBe(true);
  });

  it("is a no-op when no block exists", () => {
    expect(removeBlock("# README\n")).toBe("# README\n");
  });

  it("returns empty string when input is empty", () => {
    expect(removeBlock("")).toBe("");
  });
});
