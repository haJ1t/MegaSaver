import { describe, expect, it } from "vitest";
import { assertUncompressedRecording } from "../src/transform.js";
import type { RecordedRequest } from "../src/types.js";

// The guard exists to refuse a recording captured with the saver's hooks ON —
// both arms would replay pre-compressed output and the comparison would mean
// nothing. It must keep refusing that. But it matched the footer's opening
// literal ANYWHERE in a tool_result, so a `Read` of a file that merely mentions
// the footer tripped it, and the harness could not record against this
// repository at all. That is not a hypothetical: recording three search-heavy
// sessions against this tree failed on a Read of
// save-integrity.property.test.ts, whose STRUCTURAL_LINE list contains the
// footer pattern as a regex literal (wiki/log.md 2026-07-30).
//
// The saver appends its footer as the LAST thing in a rewritten tool_result
// (record-output.ts: `finalText = text0 + footer`), so position is what
// separates the two cases.

function requestWithToolResult(text: string): RecordedRequest {
  return {
    model: "claude-opus-5",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_x", content: text }],
      },
    ],
  } as unknown as RecordedRequest;
}

const REAL_FOOTER =
  '\n\n[Mega Saver: compressed 57732→12477 B (~14433→3120 tokens, 78.4%). Full output recoverable — stored in 36 chunks of ~40 lines each; fetch any with: mega output chunk "cs-x" "<i>" (i = 0..35) (or MCP proxy_expand_chunk if connected).]';

describe("assertUncompressedRecording", () => {
  it("still refuses a recording whose tool_result really was compressed", () => {
    const req = requestWithToolResult(`7 kept, 20 dropped\nsome excerpt${REAL_FOOTER}`);
    expect(() => assertUncompressedRecording([req])).toThrow(/already compressed/);
  });

  it("accepts a tool_result that only MENTIONS the footer in source code", () => {
    // The exact shape that blocked recording against this repo: a file read
    // whose content includes the footer pattern as a regex literal, mid-file.
    const sourceRead = [
      "const STRUCTURAL_LINE: readonly RegExp[] = [",
      "  /^… \\[lines \\d+-\\d+ omitted\\]$/,",
      "  /^\\[Mega Saver: compressed \\d+→\\d+ B .*\\]$/,",
      "];",
      "",
      "export function somethingElse(): void {}",
    ].join("\n");
    expect(() => assertUncompressedRecording([requestWithToolResult(sourceRead)])).not.toThrow();
  });

  it("accepts prose that quotes the footer without being one", () => {
    const doc =
      "The footer reads [Mega Saver: compressed 100→40 B ...] and is appended last.\nMore text follows, so this is not a footer.";
    expect(() => assertUncompressedRecording([requestWithToolResult(doc)])).not.toThrow();
  });

  it("refuses a real footer even with trailing whitespace after it", () => {
    const req = requestWithToolResult(`excerpt${REAL_FOOTER}\n  \n`);
    expect(() => assertUncompressedRecording([req])).toThrow(/already compressed/);
  });
});
