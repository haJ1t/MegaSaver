import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCacheAdviceHookOutput } from "../../src/hooks/cache-advice-run.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const CWD = process.platform === "win32" ? "C:\\tmp\\repo" : "/tmp/repo";
const SRC_DIRECTORY = process.platform === "win32" ? "C:\\tmp\\repo\\src" : "/tmp/repo/src";

function readPayload(filePath: string, sessionId = SESSION_ID): unknown {
  return {
    session_id: sessionId,
    cwd: CWD,
    tool_name: "Read",
    tool_input: { file_path: filePath },
  };
}

function grepPayload(path: string, sessionId = SESSION_ID): unknown {
  return {
    session_id: sessionId,
    cwd: CWD,
    tool_name: "Grep",
    tool_input: { path },
  };
}

describe("buildCacheAdviceHookOutput", () => {
  let testRoot: string;
  let storeRoot: string;

  beforeEach(async () => {
    testRoot = await mkdtemp(join(tmpdir(), "megasaver-cache-advice-"));
    storeRoot = join(testRoot, "store");
  });

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
  });

  it("returns additionalContext on the second eligible same-directory call", async () => {
    const first = await buildCacheAdviceHookOutput({
      payload: readPayload("src/a.ts"),
      storeRoot,
      now: () => 1_000,
    });
    const second = await buildCacheAdviceHookOutput({
      payload: grepPayload("src"),
      storeRoot,
      now: () => 2_000,
    });

    expect(first).toBe("");
    const result = JSON.parse(second) as {
      hookSpecificOutput: Record<string, unknown>;
    };
    expect(result.hookSpecificOutput).toEqual({
      hookEventName: "PreToolUse",
      additionalContext: expect.stringContaining("Batch remaining exploration"),
    });
    expect(result.hookSpecificOutput).not.toHaveProperty("permissionDecision");
  });

  it("returns empty output without state for unknown tools, missing paths, and unsafe ids", async () => {
    const invalidPayloads: unknown[] = [
      {
        session_id: SESSION_ID,
        cwd: CWD,
        tool_name: "Bash",
        tool_input: { command: "pwd" },
      },
      {
        session_id: SESSION_ID,
        cwd: CWD,
        tool_name: "Read",
        tool_input: {},
      },
      readPayload("src/a.ts", "../unsafe"),
    ];

    for (const payload of invalidPayloads) {
      await expect(
        buildCacheAdviceHookOutput({ payload, storeRoot, now: () => 1_000 }),
      ).resolves.toBe("");
    }
    await expect(stat(storeRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes session state with owner-only permissions", async () => {
    await buildCacheAdviceHookOutput({
      payload: readPayload("src/a.ts"),
      storeRoot,
      now: () => 1_000,
    });

    const stateDirectory = join(storeRoot, "stats", encodeWorkspaceKey(CWD), "cache-advice");
    const statePath = join(stateDirectory, `${SESSION_ID}.json`);
    const state = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>;

    expect(state).toEqual({
      offeredDirectories: [],
      recent: [{ tool: "Read", directory: SRC_DIRECTORY, at: 1_000 }],
    });
    if (process.platform !== "win32") {
      expect((await stat(stateDirectory)).mode & 0o777).toBe(0o700);
      expect((await stat(statePath)).mode & 0o777).toBe(0o600);
    }
  });

  it("returns empty output for state I/O and internal errors", async () => {
    const blockedStoreRoot = join(testRoot, "not-a-directory");
    await writeFile(blockedStoreRoot, "blocked");

    await expect(
      buildCacheAdviceHookOutput({
        payload: readPayload("src/a.ts"),
        storeRoot: blockedStoreRoot,
        now: () => 1_000,
      }),
    ).resolves.toBe("");
    await expect(
      buildCacheAdviceHookOutput({
        payload: readPayload("src/a.ts"),
        storeRoot,
        now: () => {
          throw new Error("clock failed");
        },
      }),
    ).resolves.toBe("");
  });
});
