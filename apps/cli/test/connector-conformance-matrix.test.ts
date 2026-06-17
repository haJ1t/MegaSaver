import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MEGA_SAVER_BLOCK_START,
  parseBlock,
  projectionPreflight,
} from "@megasaver/connectors-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectorSyncCommand } from "../src/commands/connector/index.js";
import { KNOWN_TARGETS } from "../src/known-targets.js";

// §11 projection validation matrix: every connector target must project approved
// memory into a conformant sentinel block. This pins the matrix as a regression
// guard and proves projectionPreflight accepts every real sync output, so wiring
// it into `connector sync` cannot reject a legitimate projection.
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

describe("connector projection conformance matrix", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-conformance-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-conformance-root-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function seedProject(): Promise<void> {
    await mkdir(store, { recursive: true });
    const ts = "2026-05-09T00:00:00.000Z";
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: projectRoot, createdAt: ts, updatedAt: ts },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
  }

  async function runSync(target?: string): Promise<void> {
    const cliArgs: Record<string, string> = { projectName: "demo", store };
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    if (target !== undefined) cliArgs["target"] = target;
    await connectorSyncCommand.run?.({
      args: cliArgs,
      cmd: connectorSyncCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  const readTarget = (relativePath: string): Promise<string> =>
    readFile(join(projectRoot, relativePath), "utf8");

  for (const target of KNOWN_TARGETS) {
    it(`${target.id}: seeded projection is conformant and idempotent`, async () => {
      await seedProject();
      await runSync(target.id);

      const content = await readTarget(target.relativePath);
      const expectHeader = "header" in target && Boolean(target.header);

      // (1) the rendered output passes the runtime preflight,
      expect(() => projectionPreflight(content, { expectHeader })).not.toThrow();
      // (2) it parses to exactly one managed sentinel block,
      expect(parseBlock(content).block).not.toBeNull();
      // (3) header targets keep their frontmatter OUTSIDE the block,
      if (expectHeader) {
        expect(parseBlock(content).before.trim()).not.toBe("");
        if (target.id === "cursor") {
          expect(parseBlock(content).before).toContain("description:");
        }
      }

      // (4) a second sync is a byte-identical no-op (idempotent re-projection).
      await runSync();
      expect(await readTarget(target.relativePath)).toBe(content);
    });
  }

  it("a corrupt target aborts only that connector; healthy targets still write; store intact; exit 1", async () => {
    await seedProject();
    // CLAUDE.md pre-corrupted with two begin sentinels (unbalanced block).
    const corrupt = `${MEGA_SAVER_BLOCK_START}\n${MEGA_SAVER_BLOCK_START}\nx\n`;
    await writeFile(join(projectRoot, "CLAUDE.md"), corrupt);
    // A healthy, pre-existing aider file that should still be projected.
    await writeFile(join(projectRoot, "CONVENTIONS.md"), "");

    await runSync();

    expect(process.exitCode).toBe(1);
    // The corrupt file is left UNCHANGED (write aborted for that target only).
    expect(await readTarget("CLAUDE.md")).toBe(corrupt);
    // The healthy target was projected normally.
    expect(parseBlock(await readTarget("CONVENTIONS.md")).block).not.toBeNull();
  });
});
