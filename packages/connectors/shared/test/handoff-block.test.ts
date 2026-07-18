import { describe, expect, it } from "vitest";
import {
  MEGA_SAVER_HANDOFF_BLOCK_END,
  MEGA_SAVER_HANDOFF_BLOCK_START,
  MEGA_SAVER_WS_BLOCK_START,
} from "../src/constants.js";
import { ConnectorError } from "../src/errors.js";
import { type HandoffBlockFields, renderHandoffBlockText } from "../src/handoff-block.js";
import { upsertHandoffBlockText } from "../src/upsert.js";

const FIELDS: HandoffBlockFields = {
  resumeInstructions: "You are resuming a task handed off from claude-code on project demo.",
  summaryText: "# Task summary\n- [decision] use pnpm\n- TODO: finish parser",
  gitLine: "Branch: feat/parser @ abc1234 (dirty)",
  diffText:
    "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new",
  expiresAt: "2026-07-19T12:00:00.000Z",
};

const FOOTER =
  "Expires: 2026-07-19T12:00:00.000Z — if the current date is past this, disregard this handoff and suggest `mega handoff clear`.";

describe("renderHandoffBlockText", () => {
  it("renders the exact block shape with all fields present", () => {
    expect(renderHandoffBlockText(FIELDS)).toBe(
      [
        MEGA_SAVER_HANDOFF_BLOCK_START,
        FIELDS.resumeInstructions,
        "",
        FIELDS.summaryText,
        "",
        FIELDS.gitLine,
        "",
        FIELDS.diffText,
        "",
        FOOTER,
        MEGA_SAVER_HANDOFF_BLOCK_END,
        "",
      ].join("\n"),
    );
  });

  it("wraps content in exactly one HANDOFF pair with a trailing newline", () => {
    const block = renderHandoffBlockText(FIELDS);
    expect(block.startsWith(MEGA_SAVER_HANDOFF_BLOCK_START)).toBe(true);
    expect(block.trimEnd().endsWith(MEGA_SAVER_HANDOFF_BLOCK_END)).toBe(true);
    expect(block.endsWith("\n")).toBe(true);
    expect(block.split(MEGA_SAVER_HANDOFF_BLOCK_START).length - 1).toBe(1);
    expect(block).toContain(FOOTER);
  });

  it("omits git and diff sections when null", () => {
    const block = renderHandoffBlockText({ ...FIELDS, gitLine: null, diffText: null });
    expect(block).toBe(
      [
        MEGA_SAVER_HANDOFF_BLOCK_START,
        FIELDS.resumeInstructions,
        "",
        FIELDS.summaryText,
        "",
        FOOTER,
        MEGA_SAVER_HANDOFF_BLOCK_END,
        "",
      ].join("\n"),
    );
  });

  it.each(["resumeInstructions", "summaryText", "gitLine", "diffText", "expiresAt"] as const)(
    "rejects a bare sentinel line embedded in %s",
    (field) => {
      const broken: HandoffBlockFields = { ...FIELDS };
      broken[field] = `x\n${MEGA_SAVER_HANDOFF_BLOCK_END}\ny`;
      let thrown: unknown;
      try {
        renderHandoffBlockText(broken);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(ConnectorError);
      expect((thrown as ConnectorError).code).toBe("context_invalid");
    },
  );

  it("rejects a foreign (WARM_START) sentinel smuggled in the diff", () => {
    expect(() =>
      renderHandoffBlockText({ ...FIELDS, diffText: `+${MEGA_SAVER_WS_BLOCK_START}` }),
    ).toThrow(ConnectorError);
  });

  it("normalizes CRLF and lone-CR field text so the block carries no \\r", () => {
    const block = renderHandoffBlockText({
      ...FIELDS,
      diffText: "diff --git a/a b/a\r\n--- a/a\r\n+++ b/a\r\n@@ -1 +1 @@\r\n-old\r\r\n+new",
    });
    expect(block).not.toContain("\r");
  });

  it("never writes \\r\\r\\n when upserted into a CRLF-dominant file", () => {
    const block = renderHandoffBlockText({
      ...FIELDS,
      diffText: "diff --git a/a b/a\r\n--- a/a\r\n+++ b/a\r\n@@ -1 +1 @@\r\n-old\r\r\n+new",
    });
    const result = upsertHandoffBlockText("# AGENTS\r\n\r\nhuman text\r\n", block);
    expect(result).not.toContain("\r\r\n");
    expect(result).toContain("\r\n");
  });

  it("rejects a zero-width-obfuscated sentinel in the summary", () => {
    expect(() =>
      renderHandoffBlockText({
        ...FIELDS,
        summaryText: "<!-- MEGA SAVER:HANDOFF\u200b BEGIN -->",
      }),
    ).toThrow(ConnectorError);
  });
});
