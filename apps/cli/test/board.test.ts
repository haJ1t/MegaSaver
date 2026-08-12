import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBoardFacts } from "@megasaver/mesh";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBoardList } from "../src/commands/board/list.js";
import { runBoardPost } from "../src/commands/board/post.js";
import { runBoardPromote } from "../src/commands/board/promote.js";
import { runBoardResolve } from "../src/commands/board/resolve.js";
import { ensureStoreReady } from "../src/store.js";

describe("mega board", () => {
  let root = "";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "cli-board-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("post creates fact and list shows it", async () => {
    const out: string[] = [];
    const code = await runBoardPost({
      storeFlag: root,
      cwd: "/repo",
      home: "/tmp/home",
      text: "hello board",
      topic: "My Topic",
      confidence: "high",
      stdout: (l) => out.push(l),
      stderr: () => {},
      execGit: () => {
        throw new Error("no git");
      },
    });
    expect(code).toBe(0);
    const factId = out[0] ?? "";
    expect(factId).toMatch(/^[0-9a-f-]{36}$/);
    const facts = readBoardFacts(root, {});
    expect(facts).toHaveLength(1);
    expect(facts[0]?.topic).toBe("my topic");

    const out2: string[] = [];
    await runBoardList({
      storeFlag: root,
      cwd: "/repo",
      home: "/tmp/home",
      json: true,
      all: true,
      stdout: (l) => out2.push(l),
      stderr: () => {},
    });
    const listed = JSON.parse(out2.join("\n")) as unknown[];
    expect(listed).toHaveLength(1);
  });

  it("post redacts and normalizes topic", async () => {
    await runBoardPost({
      storeFlag: root,
      cwd: "/repo",
      home: "/tmp/home",
      text: "token: sk-proj-abcdefghijklmnopqrstuvwxyz0123456789",
      topic: "  API Z  ",
      confidence: "high",
      stdout: () => {},
      stderr: () => {},
      execGit: () => {
        throw new Error("no git");
      },
    });
    const facts = readBoardFacts(root, {});
    expect(facts[0]?.text).not.toContain("sk-proj");
    expect(facts[0]?.topic).toBe("api z");
  });

  it("cross-session same topic marks both disputed via CLI", async () => {
    await runBoardPost({
      storeFlag: root,
      cwd: "/repo",
      home: "/tmp/home",
      text: "A",
      topic: "  API Z  ",
      confidence: "high",
      liveSessionId: "a1",
      stdout: () => {},
      stderr: () => {},
      execGit: () => {
        throw new Error("no git");
      },
    });
    await runBoardPost({
      storeFlag: root,
      cwd: "/repo",
      home: "/tmp/home",
      text: "B",
      topic: "api z",
      confidence: "high",
      liveSessionId: "b1",
      stdout: () => {},
      stderr: () => {},
      execGit: () => {
        throw new Error("no git");
      },
    });
    const facts = readBoardFacts(root, {
      repo: (await import("@megasaver/shared")).encodeWorkspaceKey("/repo"),
    });
    // repo is workspaceKey derived from cwd, both posts use same cwd /repo -> same repoKey -> disputed
    expect(facts.filter((f) => f.status === "disputed")).toHaveLength(2);
  });

  it("resolve marks resolved", async () => {
    const out: string[] = [];
    await runBoardPost({
      storeFlag: root,
      cwd: "/repo",
      home: "/tmp/home",
      text: "to resolve",
      topic: "t1",
      confidence: "high",
      stdout: (l) => out.push(l),
      stderr: () => {},
      execGit: () => {
        throw new Error("no git");
      },
    });
    const factId = out[0] ?? "";
    const code = await runBoardResolve({
      storeFlag: root,
      cwd: "/repo",
      home: "/tmp/home",
      factId,
      note: "done",
      stdout: () => {},
      stderr: () => {},
    });
    expect(code).toBe(0);
    const facts = readBoardFacts(root, {});
    expect(facts[0]?.status).toBe("resolved");
    expect(facts[0]?.resolution?.note).toBe("done");
  });

  it("promote via saveMemoryWithLineage → suggested", async () => {
    const { registry } = await ensureStoreReady(root);
    const now = new Date().toISOString();
    const proj = registry.createProject({
      id: crypto.randomUUID() as never,
      name: "proj1",
      rootPath: "/repo",
      createdAt: now,
      updatedAt: now,
    } as never);
    const out: string[] = [];
    await runBoardPost({
      storeFlag: root,
      cwd: "/repo",
      home: "/tmp/home",
      text: "promote me",
      topic: "promoteTopic",
      confidence: "high",
      stdout: (l) => out.push(l),
      stderr: () => {},
      execGit: () => {
        throw new Error("no git");
      },
    });
    const factId = out[out.length - 1] ?? "";
    const out2: string[] = [];
    const code = await runBoardPromote({
      storeFlag: root,
      cwd: "/repo",
      home: "/tmp/home",
      factId,
      projectName: "proj1",
      stdout: (l) => out2.push(l),
      stderr: () => {},
    });
    expect(code).toBe(0);
    const mems = registry.listMemoryEntries(proj.id);
    expect(mems).toHaveLength(1);
    expect(mems[0]?.approval).toBe("suggested");
    expect(mems[0]?.content).toBe("promote me");
    const facts = readBoardFacts(root, {});
    const promoted = facts.find((f) => f.id === factId);
    expect(promoted?.promotedTo).toBe(mems[0]?.id);
  });

  it("list filters by repo/topic/status", async () => {
    await runBoardPost({
      storeFlag: root,
      cwd: "/repo",
      home: "/tmp/home",
      text: "A",
      topic: "topicA",
      confidence: "high",
      stdout: () => {},
      stderr: () => {},
      execGit: () => {
        throw new Error("no git");
      },
    });
    await runBoardPost({
      storeFlag: root,
      cwd: "/repo",
      home: "/tmp/home",
      text: "B",
      topic: "topicB",
      confidence: "high",
      stdout: () => {},
      stderr: () => {},
      execGit: () => {
        throw new Error("no git");
      },
    });
    const out: string[] = [];
    await runBoardList({
      storeFlag: root,
      cwd: "/repo",
      home: "/tmp/home",
      topic: "topicA",
      all: true,
      json: true,
      stdout: (l) => out.push(l),
      stderr: () => {},
    });
    const listed = JSON.parse(out.join("\n")) as Array<{ topic: string }>;
    expect(listed).toHaveLength(1);
    expect(listed[0]?.topic).toBe("topica");
  });
});
