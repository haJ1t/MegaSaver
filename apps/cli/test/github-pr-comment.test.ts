import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGithubPrComment } from "../src/commands/github/pr-comment.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const APPROVED_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUGGESTED_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TS = "2026-06-12T00:00:00.000Z";
const APPROVED_CONTENT = "Approved memory content for JWT auth.";
const SUGGESTED_CONTENT = "Suggested memory not yet approved.";

describe("runGithubPrComment", () => {
  let store: string;
  const outLines: string[] = [];
  const errLines: string[] = [];

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "mega-github-test-"));
    outLines.length = 0;
    errLines.length = 0;
    await seedStore();
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  async function seedStore(): Promise<void> {
    await mkdir(store, { recursive: true });
    await mkdir(join(store, "memory"), { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
    const approved = JSON.stringify({
      id: APPROVED_ID,
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      type: "decision",
      title: "Use JWT for protected routes",
      content: APPROVED_CONTENT,
      keywords: ["jwt", "auth"],
      confidence: "high",
      source: "manual",
      approval: "approved",
      stale: false,
      createdAt: TS,
      updatedAt: TS,
    });
    const suggested = JSON.stringify({
      id: SUGGESTED_ID,
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      type: "architecture",
      title: "Consider microservices",
      content: SUGGESTED_CONTENT,
      keywords: [],
      confidence: "low",
      source: "agent",
      approval: "suggested",
      stale: false,
      createdAt: TS,
      updatedAt: TS,
    });
    await writeFile(join(store, "memory", `${PROJECT_ID}.jsonl`), `${approved}\n${suggested}\n`);
  }

  function makeInput(
    overrides: Partial<Parameters<typeof runGithubPrComment>[0]> = {},
  ): Parameters<typeof runGithubPrComment>[0] {
    return {
      projectName: "demo",
      task: "auth",
      files: [],
      limitFlag: undefined,
      postFlag: undefined,
      storeFlag: store,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      stdout: (line) => outLines.push(line),
      stderr: (line) => errLines.push(line),
      ...overrides,
    };
  }

  it("prints approved memory content to stdout", async () => {
    const code = await runGithubPrComment(makeInput());
    expect(code).toBe(0);
    const output = outLines.join("\n");
    expect(output).toContain(APPROVED_CONTENT);
  });

  it("does not include suggested memory content", async () => {
    const code = await runGithubPrComment(makeInput());
    expect(code).toBe(0);
    const output = outLines.join("\n");
    expect(output).not.toContain(SUGGESTED_CONTENT);
  });

  it("output contains the markdown heading", async () => {
    const code = await runGithubPrComment(makeInput());
    expect(code).toBe(0);
    const output = outLines.join("\n");
    expect(output).toContain("## Mega Saver — relevant project memory");
  });

  it("project-not-found returns exit 1", async () => {
    const code = await runGithubPrComment(makeInput({ projectName: "no-such-project" }));
    expect(code).toBe(1);
    expect(errLines.some((l) => l.includes("no-such-project"))).toBe(true);
  });

  it("--post is NOT the default — print-only path is the default", async () => {
    // postFlag undefined → print to stdout, no spawn invoked
    let spawnCalled = false;
    const code = await runGithubPrComment(
      makeInput({
        postFlag: undefined,
        spawnPost: async () => {
          spawnCalled = true;
          return 0;
        },
      }),
    );
    expect(code).toBe(0);
    expect(spawnCalled).toBe(false);
    expect(outLines.length).toBeGreaterThan(0);
  });

  it("--post invokes spawnPost with the body and pr number", async () => {
    const calls: { prNumber: string; body: string }[] = [];
    const code = await runGithubPrComment(
      makeInput({
        postFlag: "42",
        spawnPost: async (prNumber, body) => {
          calls.push({ prNumber, body });
          return 0;
        },
      }),
    );
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.prNumber).toBe("42");
    expect(calls[0]?.body).toContain(APPROVED_CONTENT);
    // stdout is silent when posting
    expect(outLines).toHaveLength(0);
  });

  it("--post with non-zero spawn code returns exit 1", async () => {
    const code = await runGithubPrComment(
      makeInput({
        postFlag: "1",
        spawnPost: async () => 1,
      }),
    );
    expect(code).toBe(1);
    expect(errLines.some((l) => l.includes("gh pr comment failed"))).toBe(true);
  });
});
