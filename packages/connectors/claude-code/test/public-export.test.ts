import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
// Static, like the sibling public-export tests in connectors/shared and
// connectors/generic-cli. A dynamic `await import()` inside the test body
// charged the whole workspace module graph (~450ms, and far more under a full
// `turbo run test`) to the per-test timeout; as a top-level import it is paid
// during collection instead, which no per-test budget governs.
import * as connector from "../dist/index.js";

describe("public exports", () => {
  test("built package exposes the documented runtime surface", () => {
    expect(Object.keys(connector).sort()).toEqual([
      "CLAUDE_CODE_AGENT_ID",
      "CLAUDE_MD_FILE",
      "ClaudeCodeConnectorError",
      "ClaudeCodeContextSchema",
      "DEFAULT_HOOK_COMMAND",
      "HOOK_MATCHER",
      "MEGA_SAVER_BLOCK_END",
      "MEGA_SAVER_BLOCK_START",
      "SAVER_HOOK_COMMAND",
      "SAVER_HOOK_MATCHER",
      "addPostToolUseHook",
      "addPreToolUseHook",
      "assertClaudeCodeContext",
      "buildClaudeArgs",
      "buildHookCommand",
      "claudeCodeConnectorErrorCodeSchema",
      "createClaudeCodeLauncher",
      "createClaudeRouteAdapter",
      "hasPostToolUseHook",
      "hasPreToolUseHook",
      "hookCommandMatches",
      "installClaudeCodeHook",
      "parseClaudeMd",
      "readClaudeCodeHookStatus",
      "readClaudeMd",
      "removeMegaSaverBlock",
      "removePostToolUseHook",
      "removePreToolUseHook",
      "renderClaudeCodeContext",
      "resolveClaudeCodeSettingsPath",
      "syncClaudeMdContext",
      "uninstallClaudeCodeHook",
      "upsertMegaSaverBlock",
      "writeClaudeMd",
    ]);

    expect(connector.CLAUDE_CODE_AGENT_ID).toBe("claude-code");
  });

  test("built package renders and syncs a minimal context", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "megasaver-public-export-"));
    const project = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Mega Saver",
      rootPath: projectRoot,
      createdAt: "2026-05-06T00:00:00.000Z",
      updatedAt: "2026-05-06T00:00:00.000Z",
    };
    // Parsed through the package's own exported schema rather than cast: it
    // brands ProjectId and narrows agentId, and validating the public surface
    // with the public surface is what this file is for.
    const context = connector.ClaudeCodeContextSchema.parse({
      agentId: "claude-code",
      project,
      session: null,
      memoryEntries: [],
    });

    try {
      const rendered = connector.renderClaudeCodeContext(context);
      const synced = await connector.syncClaudeMdContext({ projectRoot, context });

      expect(rendered).toContain("Mega Saver Context");
      expect(synced).toBe(rendered);
      await expect(readFile(join(projectRoot, "CLAUDE.md"), "utf8")).resolves.toBe(synced);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
