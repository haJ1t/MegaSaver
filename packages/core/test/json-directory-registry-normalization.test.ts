import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJsonDirectoryCoreRegistry } from "../src/index.js";

describe("createJsonDirectoryCoreRegistry — name normalization", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "megasaver-core-norm-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("listProjects returns NFC names for NFD entries already on disk", async () => {
    const id = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
    const NOW = "2026-05-08T12:00:00.000Z";
    // NFD literal via explicit \u escape — bypasses any editor save quirks.
    const nfdName = "café"; // 5 code units
    const nfcExpected = "café"; // 4 code units
    // Write NFD bytes directly to projects.json, simulating a pre-existing
    // entry written before NFC normalization landed.
    await writeFile(
      join(rootDir, "projects.json"),
      JSON.stringify([
        {
          id,
          name: nfdName,
          rootPath: "/tmp/demo",
          createdAt: NOW,
          updatedAt: NOW,
        },
      ]),
      "utf8",
    );
    const registry = createJsonDirectoryCoreRegistry({ rootDir });
    const projects = registry.listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]?.name).toBe(nfcExpected);
  });

  it("createProject persists NFC name to disk when caller passes NFD", async () => {
    const id = projectIdSchema.parse("22222222-2222-4222-8222-222222222222");
    const NOW = "2026-05-08T12:00:00.000Z";
    const nfdInput = "café";
    const nfcExpected = "café";
    const registry = createJsonDirectoryCoreRegistry({ rootDir });
    registry.createProject({
      id,
      name: nfdInput,
      rootPath: "/tmp/demo",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const raw = await readFile(join(rootDir, "projects.json"), "utf8");
    const parsed = JSON.parse(raw) as Array<{ name: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.name).toBe(nfcExpected);
  });
});
