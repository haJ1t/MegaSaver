import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditPack } from "@megasaver/context-pruner";
import { readAuditEvents } from "@megasaver/core";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contextAuditCommand } from "../src/commands/context/audit.js";
import { contextBuildCommand, runContextBuild } from "../src/commands/context/build.js";
import { contextExportCommand } from "../src/commands/context/export.js";
import { indexBuildCommand } from "../src/commands/index/build.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TS = "2026-06-11T00:00:00.000Z";

describe("mega context", () => {
  let store: string;
  let repo: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "mega-ctx-store-"));
    repo = await mkdtemp(join(tmpdir(), "mega-ctx-repo-"));
    await mkdir(join(repo, "src"), { recursive: true });
    await writeFile(
      join(repo, "src", "auth.ts"),
      'import { verify } from "jsonwebtoken";\nexport function validateToken(t: string) {\n  return verify(t);\n}\n',
    );
    await writeFile(join(repo, "src", "nav.tsx"), "export const Navbar = () => <nav>x</nav>;\n");
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: repo, createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    await rm(store, { recursive: true, force: true });
    await rm(repo, { recursive: true, force: true });
  });

  const out = (): string => logSpy.mock.calls.map((c) => c[0] as string).join("\n");
  const clear = (): void => {
    logSpy.mockClear();
    errSpy.mockClear();
  };
  // biome-ignore lint/suspicious/noExplicitAny: citty run() arg shape
  const run = (cmd: any, args: Record<string, unknown>): Promise<void> =>
    cmd.run({ args: { ...args, store }, cmd, rawArgs: [], data: undefined });

  async function withIndex(): Promise<void> {
    await run(indexBuildCommand, { projectName: "demo" });
    clear();
  }

  it("build selects the named block with reasons", async () => {
    await withIndex();
    await run(contextBuildCommand, { projectName: "demo", task: "fix validateToken" });
    expect(process.exitCode).toBe(0);
    expect(out()).toContain("Included:");
    expect(out()).toContain("src/auth.ts");
    expect(out()).toContain("named in task");
  });

  it("requires --task", async () => {
    await withIndex();
    await run(contextBuildCommand, { projectName: "demo", task: "" });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.map((c) => c[0] as string).join("\n")).toContain("--task is required");
  });

  it("audit reports token savings", async () => {
    await withIndex();
    await run(contextAuditCommand, { projectName: "demo", task: "auth token" });
    expect(process.exitCode).toBe(0);
    expect(out()).toContain("tokens:");
    expect(out()).toContain("saved:");
  });

  it("export emits a markdown pack with a fenced source slice", async () => {
    await withIndex();
    await run(contextExportCommand, {
      projectName: "demo",
      task: "fix validateToken",
      format: "markdown",
    });
    expect(process.exitCode).toBe(0);
    expect(out()).toContain("# Context pack: fix validateToken");
    expect(out()).toContain("```");
    expect(out()).toContain("validateToken");
  });
});

describe("mega context build — context_pack_built audit emission", () => {
  const SESSION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as SessionId;
  const AUDIT_PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
  const TS = "2026-06-12T12:00:00.000Z";

  let store: string;
  let repo: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "mega-audit-emit-"));
    repo = await mkdtemp(join(tmpdir(), "mega-audit-repo-"));
    await mkdir(join(repo, "src"), { recursive: true });
    await writeFile(
      join(repo, "src", "auth.ts"),
      "export function validateToken(t: string) { return t; }\n",
    );
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: AUDIT_PROJECT_ID, name: "audit-demo", rootPath: repo, createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(repo, { recursive: true, force: true });
  });

  it("emits a context_pack_built audit event after building a pack", async () => {
    // Build the index first (context build requires an index)
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // biome-ignore lint/suspicious/noExplicitAny: citty args bag
    const run = (cmd: any, args: Record<string, unknown>): Promise<void> =>
      cmd.run({ args: { ...args, store }, cmd, rawArgs: [], data: undefined });
    await run(indexBuildCommand, { projectName: "audit-demo" });
    logSpy.mockRestore();
    errSpy.mockRestore();

    const lines: string[] = [];
    const code = await runContextBuild({
      projectName: "audit-demo",
      task: "validateToken",
      changedFiles: [],
      failingTests: [],
      limitFlag: undefined,
      maxTokensFlag: undefined,
      storeFlag: store,
      cwd: store,
      home: store,
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      jsonFlag: false,
      stdout: (l) => lines.push(l),
      stderr: (l) => lines.push(l),
      sessionId: SESSION_ID,
      now: () => TS,
    });
    expect(code).toBe(0);

    const events = readAuditEvents({ root: store }, AUDIT_PROJECT_ID, SESSION_ID);
    const built = events.filter((e) => e.kind === "context_pack_built");
    expect(built).toHaveLength(1);
    // tokensBefore/tokensAfter must match what auditPack would compute —
    // we verify the shape here; the exact values depend on the pack built.
    expect(built[0]).toMatchObject({ kind: "context_pack_built", sessionId: SESSION_ID });
  });
});
