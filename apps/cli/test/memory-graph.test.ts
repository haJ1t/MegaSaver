import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Graph } from "@megasaver/memory-graph";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Import will fail until graph.ts is created — that's the RED state.
import { runMemoryGraph } from "../src/commands/memory/graph.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const MEMORY_ID_SESSION = "22222222-2222-4222-8222-222222222222";
const MEMORY_ID_PROJECT = "33333333-3333-4333-8333-333333333333";
const TS = "2026-05-09T00:00:00.000Z";

describe("runMemoryGraph", () => {
  let store: string;
  const lines: string[] = [];
  const errLines: string[] = [];

  function makeInput(over: Partial<Parameters<typeof runMemoryGraph>[0]> = {}) {
    return {
      projectName: "demo",
      storeFlag: store,
      jsonFlag: false,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      xdgDataHome: undefined,
      platform: process.platform as NodeJS.Platform,
      localAppData: undefined,
      stdout: (line: string) => lines.push(line),
      stderr: (line: string) => errLines.push(line),
      ...over,
    };
  }

  async function seed(): Promise<void> {
    await mkdir(join(store, "memory"), { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(
      join(store, "sessions.json"),
      JSON.stringify([
        {
          id: SESSION_ID,
          projectId: PROJECT_ID,
          agentId: "claude-code",
          riskLevel: "medium",
          title: null,
          startedAt: TS,
          endedAt: null,
        },
      ]),
    );
    const sessionEntry = JSON.stringify({
      id: MEMORY_ID_SESSION,
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      scope: "session",
      type: "decision",
      title: "session-note",
      content: "checked CSRF token expiry",
      keywords: [],
      confidence: "medium",
      source: "agent",
      approval: "approved",
      stale: false,
      createdAt: TS,
      updatedAt: TS,
    });
    const projectEntry = JSON.stringify({
      id: MEMORY_ID_PROJECT,
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      type: "decision",
      title: "project-note",
      content: "user prefers TS",
      keywords: [],
      confidence: "medium",
      source: "manual",
      approval: "approved",
      stale: false,
      createdAt: TS,
      updatedAt: TS,
    });
    await writeFile(
      join(store, "memory", `${PROJECT_ID}.jsonl`),
      `${sessionEntry}\n${projectEntry}\n`,
    );
  }

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-memgraph-"));
    lines.length = 0;
    errLines.length = 0;
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  it("emits JSON graph with correct nodes and stats when --json", async () => {
    await seed();
    const code = await runMemoryGraph(makeInput({ jsonFlag: true }));
    expect(code).toBe(0);
    expect(lines).toHaveLength(1);
    const graph = JSON.parse(lines[0] ?? "") as Graph;
    expect(graph.nodes).toBeDefined();
    expect(graph.edges).toBeDefined();
    expect(graph.stats.nodeCount).toBe(graph.nodes.length);
    // project node + session node + 2 memory nodes = 4 minimum
    expect(graph.nodes.length).toBeGreaterThanOrEqual(4);
    const memNodes = graph.nodes.filter((n) => n.kind === "memory");
    expect(memNodes.length).toBe(2);
    const projectNodes = graph.nodes.filter((n) => n.kind === "project");
    expect(projectNodes.length).toBe(1);
  });

  it("emits summary line (no --json)", async () => {
    await seed();
    const code = await runMemoryGraph(makeInput({ jsonFlag: false }));
    expect(code).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/nodes=\d+ edges=\d+/);
  });

  it("returns 1 and error message for unknown project", async () => {
    await seed();
    const code = await runMemoryGraph(makeInput({ projectName: "nope", jsonFlag: true }));
    expect(code).toBe(1);
    expect(errLines.some((l) => /project "nope" not found/.test(l))).toBe(true);
  });
});
