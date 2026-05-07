import { describe, expect, it } from "vitest";
import { upsertBlock } from "../src/upsert.js";
import { buildContext } from "./fixtures.js";

describe("upsertBlock", () => {
  it("inserts a block when no block is present", () => {
    const result = upsertBlock({ existingContent: "", context: buildContext() });
    expect(result).toContain("<!-- MEGA SAVER:BEGIN -->");
    expect(result.endsWith("\n")).toBe(true);
  });

  it("preserves user content above the inserted block", () => {
    const result = upsertBlock({
      existingContent: "# My README\n\nintro\n",
      context: buildContext(),
    });
    expect(result.startsWith("# My README\n\nintro\n\n")).toBe(true);
    expect(result).toContain("<!-- MEGA SAVER:BEGIN -->");
  });

  it("upsertBlock preserves CRLF dominant input", () => {
    const result = upsertBlock({
      existingContent: "# H\r\n\r\nintro\r\n",
      context: buildContext(),
    });
    expect(result.includes("\r\n")).toBe(true);
    expect(/(?<!\r)\n/.test(result)).toBe(false);
  });

  it("upsertBlock keeps LF when LF-dominant", () => {
    const result = upsertBlock({
      existingContent: "# H\n\nintro\n",
      context: buildContext(),
    });
    expect(result.includes("\r\n")).toBe(false);
  });

  it("replaces an existing block in place", () => {
    const first = upsertBlock({
      existingContent: "intro\n",
      context: buildContext({ projectName: "first" }),
    });
    const replaced = upsertBlock({
      existingContent: first,
      context: buildContext({ projectName: "second" }),
    });
    expect(replaced).toContain("Project: second");
    expect(replaced).not.toContain("Project: first");
    expect(replaced.split("<!-- MEGA SAVER:BEGIN -->").length - 1).toBe(1);
  });
});
