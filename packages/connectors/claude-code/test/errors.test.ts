import { describe, expect, test } from "vitest";
import {
  ClaudeCodeConnectorError,
  type ClaudeCodeConnectorErrorCode,
} from "../src/index.js";

describe("ClaudeCodeConnectorError", () => {
  test("carries typed code and optional file path", () => {
    const error = new ClaudeCodeConnectorError(
      "claude_md_read_failed",
      "Could not read CLAUDE.md.",
      { filePath: "/tmp/project/CLAUDE.md" },
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ClaudeCodeConnectorError");
    expect(error.code).toBe("claude_md_read_failed");
    expect(error.filePath).toBe("/tmp/project/CLAUDE.md");
    expect(error.message).toBe("Could not read CLAUDE.md.");
  });

  test("exposes all planned error codes as a type", () => {
    const codes: ClaudeCodeConnectorErrorCode[] = [
      "claude_md_context_invalid",
      "claude_md_block_conflict",
      "claude_md_read_failed",
      "claude_md_write_failed",
      "project_root_invalid",
    ];

    expect(codes).toHaveLength(5);
  });
});
