import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexBuildCommand } from "../src/commands/index/build.js";
import { indexSearchCommand } from "../src/commands/index/search.js";
import { indexShowCommand } from "../src/commands/index/show.js";
import { indexStatusCommand } from "../src/commands/index/status.js";
import { scanCommand } from "../src/commands/scan.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TS = "2026-06-11T00:00:00.000Z";

describe("mega scan + mega index", () => {
  let store: string;
  let repo: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "mega-cli-store-"));
    repo = await mkdtemp(join(tmpdir(), "mega-cli-repo-"));
    await mkdir(join(repo, "src"), { recursive: true });
    await writeFile(
      join(repo, "src", "auth.ts"),
      'import { verify } from "jsonwebtoken";\nexport function validateToken(t: string) {\n  return verify(t);\n}\n',
    );
    await writeFile(join(repo, "README.md"), "# Project\n\nDocs here.\n");
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

  it("scan lists repo source files", async () => {
    await run(scanCommand, { projectName: "demo" });
    expect(process.exitCode).toBe(0);
    expect(out()).toContain("src/auth.ts");
    expect(out()).toContain("README.md");
  });

  it("index build reports added blocks and is incrementally idempotent", async () => {
    await run(indexBuildCommand, { projectName: "demo" });
    expect(process.exitCode).toBe(0);
    expect(out()).toMatch(/added=\d+/);

    clear();
    await run(indexBuildCommand, { projectName: "demo" });
    expect(out()).toMatch(/unchanged=\d+/);
    expect(out()).toMatch(/added=0/);
  });

  it("index status shows block totals after a build", async () => {
    await run(indexBuildCommand, { projectName: "demo" });
    clear();
    await run(indexStatusCommand, { projectName: "demo" });
    expect(process.exitCode).toBe(0);
    expect(out().toLowerCase()).toContain("function");
  });

  it("index search ranks a block by query", async () => {
    await run(indexBuildCommand, { projectName: "demo" });
    clear();
    await run(indexSearchCommand, { projectName: "demo", query: "validateToken" });
    expect(process.exitCode).toBe(0);
    expect(out()).toContain("src/auth.ts");
    expect(out()).toContain("validateToken");
  });

  it("index show renders a block with its source slice", async () => {
    await run(indexBuildCommand, { projectName: "demo" });
    clear();
    await run(indexSearchCommand, { projectName: "demo", query: "validateToken", json: true });
    const hits = JSON.parse(out()) as Array<{ id: string }>;
    const blockId = hits[0]?.id ?? "";
    expect(blockId.length).toBeGreaterThan(0);

    clear();
    await run(indexShowCommand, { projectName: "demo", blockId });
    expect(process.exitCode).toBe(0);
    expect(out()).toContain("validateToken");
    expect(out()).toContain("src/auth.ts");
  });
});
