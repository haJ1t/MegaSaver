import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GenericCliConnectorError } from "../src/errors.js";
import { readGenericCliTarget, syncGenericCliTarget, writeGenericCliTarget } from "../src/sync.js";
import { codexTarget } from "../src/targets.js";
import { buildCodexContext } from "./fixtures.js";

describe("syncGenericCliTarget", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-generic-cli-"));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("creates AGENTS.md with the rendered block when missing", async () => {
    await syncGenericCliTarget({
      projectRoot,
      target: codexTarget,
      context: buildCodexContext(),
    });
    const written = await readFile(join(projectRoot, "AGENTS.md"), "utf8");
    expect(written).toContain("Agent: codex");
  });

  it("preserves existing user content above the block", async () => {
    await writeFile(join(projectRoot, "AGENTS.md"), "# notes\n", "utf8");
    await syncGenericCliTarget({
      projectRoot,
      target: codexTarget,
      context: buildCodexContext(),
    });
    const written = await readFile(join(projectRoot, "AGENTS.md"), "utf8");
    expect(written.startsWith("# notes\n")).toBe(true);
  });

  it("replaces the block on second sync", async () => {
    await syncGenericCliTarget({
      projectRoot,
      target: codexTarget,
      context: buildCodexContext(),
    });
    await syncGenericCliTarget({
      projectRoot,
      target: codexTarget,
      context: buildCodexContext(),
    });
    const written = await readFile(join(projectRoot, "AGENTS.md"), "utf8");
    expect(written.match(/MEGA SAVER:BEGIN/g)?.length).toBe(1);
  });

  it("rejects context with mismatched agentId", async () => {
    await expect(
      syncGenericCliTarget({
        projectRoot,
        target: codexTarget,
        context: buildCodexContext({ agentId: "claude-code" }),
      }),
    ).rejects.toBeInstanceOf(GenericCliConnectorError);
  });

  it("rejects two-block files with block_conflict", async () => {
    await writeFile(
      join(projectRoot, "AGENTS.md"),
      "<!-- MEGA SAVER:BEGIN -->\n<!-- MEGA SAVER:END -->\n<!-- MEGA SAVER:BEGIN -->\n<!-- MEGA SAVER:END -->\n",
      "utf8",
    );
    const err = await syncGenericCliTarget({
      projectRoot,
      target: codexTarget,
      context: buildCodexContext(),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(GenericCliConnectorError);
    expect(err.code).toBe("block_conflict");
  });

  it("readGenericCliTarget returns null when file is missing", async () => {
    expect(await readGenericCliTarget({ projectRoot, target: codexTarget })).toBeNull();
  });

  it("writeGenericCliTarget round-trips with readGenericCliTarget", async () => {
    await writeGenericCliTarget({
      projectRoot,
      target: codexTarget,
      content: "raw\n",
    });
    expect(await readGenericCliTarget({ projectRoot, target: codexTarget })).toBe("raw\n");
  });

  it("rejects relative projectRoot with project_root_invalid", async () => {
    const err = await syncGenericCliTarget({
      projectRoot: "relative/path",
      target: codexTarget,
      context: buildCodexContext(),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(GenericCliConnectorError);
    expect(err.code).toBe("project_root_invalid");
  });
});
