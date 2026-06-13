import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBlock } from "@megasaver/connectors-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runConnectorSync } from "../src/commands/connector/index.js";

describe("cross-agent shared memory (Phase 9 exit criterion)", () => {
  let store: string;
  let projectRoot: string;
  const PID = "77777777-7777-4777-8777-777777777777";
  const MEM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const TS = "2026-06-12T00:00:00.000Z";
  const DECISION = "AUTH BUG: the login token is double-encoded";

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-xagent-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-xagent-root-"));
    process.exitCode = 0;
    await mkdir(store, { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PID, name: "demo", rootPath: projectRoot, createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
    await mkdir(join(store, "memory"), { recursive: true });
    await writeFile(
      join(store, "memory", `${PID}.jsonl`),
      `${JSON.stringify({
        id: MEM,
        projectId: PID,
        sessionId: null,
        scope: "project",
        content: DECISION,
        createdAt: TS,
      })}\n`,
    );
  });

  afterEach(async () => {
    process.exitCode = 0;
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function sync(target: string): Promise<void> {
    await runConnectorSync({
      projectName: "demo",
      targetFlag: target,
      storeFlag: store,
      cwd: projectRoot,
      home: "/tmp",
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      stdout: () => {},
      stderr: () => {},
      json: false,
    });
  }

  // The rendered block carries one per-agent line — `Agent: <id>` — which is
  // metadata, not shared memory. Stripping it yields the memory-derived body
  // that MUST be byte-identical across every agent (spec §7). Everything else
  // (project header, session, risk, the ## Memory section) is target-agnostic.
  function memoryBody(block: string): string {
    return block
      .split("\n")
      .filter((line) => !line.startsWith("Agent: "))
      .join("\n");
  }

  it("syncs the same project memory to claude-code and cursor", async () => {
    await sync("claude-code");
    await sync("cursor");

    const claude = await readFile(join(projectRoot, "CLAUDE.md"), "utf8");
    const cursor = await readFile(join(projectRoot, ".cursor/rules/megasaver.mdc"), "utf8");

    // 1. The decision recorded once surfaces in BOTH agents' files.
    expect(claude).toContain(DECISION);
    expect(cursor).toContain(DECISION);

    // 2. Both files have a valid Mega Saver block.
    const claudeBlock = parseBlock(claude).block;
    const cursorBlock = parseBlock(cursor).block;
    expect(claudeBlock).not.toBeNull();
    expect(cursorBlock).not.toBeNull();

    // 3. The memory-derived block body is BYTE-IDENTICAL across agents
    //    (cursor's frontmatter lives OUTSIDE the sentinel block). This is the
    //    Phase 9 exit criterion: same project memory shared across agents.
    expect(memoryBody(cursorBlock as string)).toBe(memoryBody(claudeBlock as string));
  });

  it("a new gemini target participates in the shared-memory guarantee", async () => {
    await sync("claude-code");
    await sync("gemini");
    const claude = await readFile(join(projectRoot, "CLAUDE.md"), "utf8");
    const gemini = await readFile(join(projectRoot, "GEMINI.md"), "utf8");
    expect(gemini).toContain(DECISION);

    const claudeBlock = parseBlock(claude).block;
    const geminiBlock = parseBlock(gemini).block;
    expect(claudeBlock).not.toBeNull();
    expect(geminiBlock).not.toBeNull();
    expect(memoryBody(geminiBlock as string)).toBe(memoryBody(claudeBlock as string));
  });
});
