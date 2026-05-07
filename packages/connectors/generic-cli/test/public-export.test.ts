import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as pkg from "../dist/index.js";

describe("@megasaver/connector-generic-cli public exports", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-generic-cli-smoke-"));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("exposes the v0.1 surface", () => {
    expect(typeof pkg.findTarget).toBe("function");
    expect(pkg.codexTarget.id).toBe("codex");
    expect(typeof pkg.syncGenericCliTarget).toBe("function");
    expect(typeof pkg.readGenericCliTarget).toBe("function");
    expect(typeof pkg.writeGenericCliTarget).toBe("function");
    expect(typeof pkg.assertGenericCliContext).toBe("function");
    expect(typeof pkg.GenericCliConnectorError).toBe("function");
    expect(pkg.genericCliConnectorErrorCodeSchema).toBeDefined();
  });

  it("smoke syncs a codex target end-to-end", async () => {
    const NOW = "2026-05-07T12:00:00.000Z";
    const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
    const ctx = {
      agentId: "codex",
      project: {
        id: PROJECT_ID,
        name: "smoke",
        rootPath: projectRoot,
        createdAt: NOW,
        updatedAt: NOW,
      },
      session: null,
      memoryEntries: [],
    };
    const written = await pkg.syncGenericCliTarget({
      projectRoot,
      target: pkg.codexTarget,
      context: ctx as never,
    });
    expect(written).toContain("Agent: codex");
  });
});
