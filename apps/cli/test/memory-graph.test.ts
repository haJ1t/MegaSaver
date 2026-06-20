import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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
  let rootPath: string;
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
      JSON.stringify([{ id: PROJECT_ID, name: "demo", rootPath, createdAt: TS, updatedAt: TS }]),
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
    rootPath = await mkdtemp(join(tmpdir(), "megasaver-cli-memgraph-root-"));
    lines.length = 0;
    errLines.length = 0;
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(rootPath, { recursive: true, force: true });
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

  it("--json graph includes wiki node + wiki-link when project rootPath has wiki/entities/", async () => {
    await seed();
    const wikiRoot = join(rootPath, "wiki");
    await mkdir(join(wikiRoot, "entities"), { recursive: true });
    await mkdir(join(wikiRoot, "concepts"), { recursive: true });
    await writeFile(
      join(wikiRoot, "entities", "a.md"),
      "---\ntitle: Entity A\ntags: []\nstatus: active\n---\nLinks to [[concepts/b]].\n",
    );
    await writeFile(join(wikiRoot, "concepts", "b.md"), "# Concept B\nNo links.\n");

    const code = await runMemoryGraph(makeInput({ jsonFlag: true }));
    expect(code).toBe(0);
    const graph = JSON.parse(lines[0] ?? "") as Graph;

    const wikiNodeA = graph.nodes.find((n) => n.kind === "wiki" && n.id === "entities/a.md");
    expect(wikiNodeA).toBeDefined();

    const wikiNodeB = graph.nodes.find((n) => n.kind === "wiki" && n.id === "concepts/b.md");
    expect(wikiNodeB).toBeDefined();

    const wikiLinkEdge = graph.edges.find(
      (e) => e.kind === "wiki-link" && e.from === "entities/a.md" && e.to === "concepts/b.md",
    );
    expect(wikiLinkEdge).toBeDefined();
  });

  it("backtick-wrapped wiki citation and memory relatedFiles share ONE file node", async () => {
    await seed();
    const wikiRoot = join(rootPath, "wiki");
    await mkdir(join(wikiRoot, "entities"), { recursive: true });
    // Wiki page cites src/shared/x.ts wrapped in backticks — the real-world pattern.
    await writeFile(
      join(wikiRoot, "entities", "ref.md"),
      "---\ntitle: Ref\ntags: []\nstatus: active\n---\nSome claim (source: `src/shared/x.ts`).\n",
    );
    // Seed a memory whose relatedFiles includes the same path WITHOUT backticks.
    await writeFile(
      join(store, "memory", `${PROJECT_ID}.jsonl`),
      `${JSON.stringify({
        id: MEMORY_ID_SESSION,
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
        scope: "session",
        type: "decision",
        title: "uses shared",
        content: "uses src/shared/x.ts",
        keywords: [],
        confidence: "medium",
        source: "agent",
        approval: "approved",
        stale: false,
        relatedFiles: ["src/shared/x.ts"],
        createdAt: TS,
        updatedAt: TS,
      })}\n`,
    );

    const code = await runMemoryGraph(makeInput({ jsonFlag: true }));
    expect(code).toBe(0);
    const graph = JSON.parse(lines[0] ?? "") as Graph;

    // Exactly ONE file node for src/shared/x.ts (not two with/without backticks).
    const fileNodes = graph.nodes.filter((n) => n.kind === "file" && n.id === "src/shared/x.ts");
    expect(fileNodes).toHaveLength(1);

    // That node must have BOTH a code-link (from memory) AND a wiki-cite (from wiki).
    const codeLink = graph.edges.find((e) => e.kind === "code-link" && e.to === "src/shared/x.ts");
    expect(codeLink).toBeDefined();
    const wikiCite = graph.edges.find((e) => e.kind === "wiki-cite" && e.to === "src/shared/x.ts");
    expect(wikiCite).toBeDefined();
  });

  it("./-prefixed memory relatedFiles and plain wiki citation share ONE file node", async () => {
    await seed();
    const wikiRoot = join(rootPath, "wiki");
    await mkdir(join(wikiRoot, "entities"), { recursive: true });
    await writeFile(
      join(wikiRoot, "entities", "ref.md"),
      "---\ntitle: Ref\ntags: []\nstatus: active\n---\nSome claim (source: src/shared/x.ts).\n",
    );
    await writeFile(
      join(store, "memory", `${PROJECT_ID}.jsonl`),
      `${JSON.stringify({
        id: MEMORY_ID_SESSION,
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
        scope: "session",
        type: "decision",
        title: "uses shared",
        content: "uses src/shared/x.ts",
        keywords: [],
        confidence: "medium",
        source: "agent",
        approval: "approved",
        stale: false,
        relatedFiles: ["./src/shared/x.ts"],
        createdAt: TS,
        updatedAt: TS,
      })}\n`,
    );

    const code = await runMemoryGraph(makeInput({ jsonFlag: true }));
    expect(code).toBe(0);
    const graph = JSON.parse(lines[0] ?? "") as Graph;

    const fileNodes = graph.nodes.filter((n) => n.kind === "file" && n.id === "src/shared/x.ts");
    expect(fileNodes).toHaveLength(1);

    const codeLink = graph.edges.find((e) => e.kind === "code-link" && e.to === "src/shared/x.ts");
    expect(codeLink).toBeDefined();
    const wikiCite = graph.edges.find((e) => e.kind === "wiki-cite" && e.to === "src/shared/x.ts");
    expect(wikiCite).toBeDefined();
  });

  it(":line-suffixed memory relatedFiles and plain wiki citation share ONE file node", async () => {
    await seed();
    const wikiRoot = join(rootPath, "wiki");
    await mkdir(join(wikiRoot, "entities"), { recursive: true });
    await writeFile(
      join(wikiRoot, "entities", "ref.md"),
      "---\ntitle: Ref\ntags: []\nstatus: active\n---\nSome claim (source: src/shared/x.ts:12).\n",
    );
    await writeFile(
      join(store, "memory", `${PROJECT_ID}.jsonl`),
      `${JSON.stringify({
        id: MEMORY_ID_SESSION,
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
        scope: "session",
        type: "decision",
        title: "uses shared",
        content: "uses src/shared/x.ts",
        keywords: [],
        confidence: "medium",
        source: "agent",
        approval: "approved",
        stale: false,
        relatedFiles: ["src/shared/x.ts:12"],
        createdAt: TS,
        updatedAt: TS,
      })}\n`,
    );

    const code = await runMemoryGraph(makeInput({ jsonFlag: true }));
    expect(code).toBe(0);
    const graph = JSON.parse(lines[0] ?? "") as Graph;

    const fileNodes = graph.nodes.filter((n) => n.kind === "file" && n.id === "src/shared/x.ts");
    expect(fileNodes).toHaveLength(1);

    const codeLink = graph.edges.find((e) => e.kind === "code-link" && e.to === "src/shared/x.ts");
    expect(codeLink).toBeDefined();
    const wikiCite = graph.edges.find((e) => e.kind === "wiki-cite" && e.to === "src/shared/x.ts");
    expect(wikiCite).toBeDefined();
  });

  it("path-safety: symlink inside wiki/ pointing outside is NOT followed", async () => {
    await seed();
    const secretMarker = "TOPSECRET-cli-should-never-appear";
    const outsidePath = join(rootPath, "outside-secret.md");
    await writeFile(outsidePath, `# Outside\n${secretMarker}\n`);

    const wikiRoot = join(rootPath, "wiki");
    await mkdir(join(wikiRoot, "entities"), { recursive: true });
    // A valid in-tree page so wiki ingestion definitely runs.
    await writeFile(join(wikiRoot, "entities", "safe.md"), "# Safe\nno links\n");
    // Symlink inside the walked tree whose target escapes wiki/. Exercises both
    // Dirent.isSymbolicLink() skip and resolved-path confinement guard — without
    // them, escape.md would be read and the secret would leak.
    await symlink(outsidePath, join(wikiRoot, "entities", "escape.md"));

    const code = await runMemoryGraph(makeInput({ jsonFlag: true }));
    expect(code).toBe(0);
    const graph = JSON.parse(lines[0] ?? "") as Graph;

    // safe.md inside wiki/ IS present (proves the walk actually ran).
    const safeNode = graph.nodes.find((n) => n.kind === "wiki" && n.id === "entities/safe.md");
    expect(safeNode).toBeDefined();

    // No wiki node for the symlink that escapes the tree.
    const escapeNode = graph.nodes.find((n) => n.kind === "wiki" && n.id === "entities/escape.md");
    expect(escapeNode).toBeUndefined();

    // Secret content and path must not surface anywhere in the serialized graph.
    const serialized = JSON.stringify(graph);
    expect(serialized).not.toContain(secretMarker);
    expect(serialized).not.toContain("outside-secret");
  });

  it("path-safety: TOP-LEVEL wiki folder that is a symlink is NOT followed", async () => {
    await seed();

    // Create a real directory OUTSIDE the wiki tree with a page.
    const outsideDir = join(rootPath, "outside-dir");
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, "leaked.md"), "# Leaked\nno links\n");

    const wikiRoot = join(rootPath, "wiki");
    // Create one real folder so the walk definitely runs.
    await mkdir(join(wikiRoot, "concepts"), { recursive: true });
    await writeFile(join(wikiRoot, "concepts", "safe.md"), "# Safe\nno links\n");
    // entities/ is a TOP-LEVEL symlink pointing outside the wiki tree.
    await symlink(outsideDir, join(wikiRoot, "entities"));

    const code = await runMemoryGraph(makeInput({ jsonFlag: true }));
    expect(code).toBe(0);
    const graph = JSON.parse(lines[0] ?? "") as Graph;

    // safe.md inside concepts/ IS present (proves the walk ran).
    const safeNode = graph.nodes.find((n) => n.kind === "wiki" && n.id === "concepts/safe.md");
    expect(safeNode).toBeDefined();

    // leaked.md from the symlinked entities/ dir must NOT appear as a wiki node.
    // Without the fix, the loader calls walkDir(join(wikiRoot, "entities")) which
    // reads through the symlink and ingests leaked.md as "entities/leaked.md".
    const leakedNode = graph.nodes.find((n) => n.kind === "wiki" && n.id === "entities/leaked.md");
    expect(leakedNode).toBeUndefined();
  });
});
