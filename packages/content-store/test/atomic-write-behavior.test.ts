import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonDirectoryCoreRegistry } from "@megasaver/core";
import { projectIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { atomicWriteFile } from "../src/atomic-write.js";

// Both the content-store and core atomic-write implementations call
// `renameSync` from the same shared `node:fs` module instance. A single
// hoisted mock therefore intercepts the rename(2) of BOTH implementations,
// letting the parity test inject a fault at the exact rename boundary
// (scenario 2) without touching either production source. `renameAtomically`
// stays true except while a test arms the fault.
const renameControl = vi.hoisted(() => ({ failNextRename: false }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    renameSync: (
      oldPath: Parameters<typeof actual.renameSync>[0],
      newPath: Parameters<typeof actual.renameSync>[1],
    ) => {
      if (renameControl.failNextRename) {
        renameControl.failNextRename = false;
        throw Object.assign(new Error("EIO: injected rename fault"), { code: "EIO" });
      }
      return actual.renameSync(oldPath, newPath);
    },
  };
});

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "atomic-parity-"));
  renameControl.failNextRename = false;
});

afterEach(() => {
  renameControl.failNextRename = false;
  rmSync(workdir, { recursive: true, force: true });
});

function leftoverTempFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith(".tmp"));
}

function coreWriteProject(rootDir: string): void {
  const registry = createJsonDirectoryCoreRegistry({ rootDir });
  registry.createProject({
    id: projectIdSchema.parse(randomUUID()),
    name: "parity",
    rootPath: rootDir,
    createdAt: "2026-05-10T12:00:00.000Z",
    updatedAt: "2026-05-10T12:00:00.000Z",
  });
}

describe("atomic-write behavioural parity vs core", () => {
  it("scenario 1 — success: exact bytes written, no leftover tmp", () => {
    const csDir = join(workdir, "cs");
    mkdirSync(csDir, { recursive: true });
    const csFile = join(csDir, "out.json");
    atomicWriteFile(csFile, '{"ok":true}\n');
    expect(readFileSync(csFile, "utf8")).toBe('{"ok":true}\n');
    expect(leftoverTempFiles(csDir)).toEqual([]);

    const coreRoot = join(workdir, "core-store");
    mkdirSync(coreRoot, { recursive: true });
    coreWriteProject(coreRoot);
    expect(existsSync(join(coreRoot, "projects.json"))).toBe(true);
    expect(leftoverTempFiles(coreRoot)).toEqual([]);
  });

  it("scenario 2 — crash-during-rename: original intact, no partial final, temp cleaned", () => {
    // content-store: an existing file plays the role of the "original" final
    // file. The rename(2) faults, so the original must survive untouched and
    // the temp must be removed by the error path.
    const csDir = join(workdir, "cs-rename-fault");
    mkdirSync(csDir, { recursive: true });
    const csFile = join(csDir, "out.json");
    writeFileSync(csFile, "ORIGINAL");

    renameControl.failNextRename = true;
    expect(() => atomicWriteFile(csFile, "REPLACEMENT")).toThrow();
    expect(renameControl.failNextRename).toBe(false); // fault was actually exercised
    expect(readFileSync(csFile, "utf8")).toBe("ORIGINAL");
    expect(leftoverTempFiles(csDir)).toEqual([]);

    // core: seed projects.json as the original final file, then fault its
    // rename via createProject. Same observable on-disk invariant.
    const coreRoot = join(workdir, "core-rename-fault");
    mkdirSync(coreRoot, { recursive: true });
    const coreFinal = join(coreRoot, "projects.json");
    writeFileSync(coreFinal, "[]\n");

    renameControl.failNextRename = true;
    expect(() => coreWriteProject(coreRoot)).toThrow();
    expect(renameControl.failNextRename).toBe(false); // fault was actually exercised
    expect(readFileSync(coreFinal, "utf8")).toBe("[]\n");
    expect(leftoverTempFiles(coreRoot)).toEqual([]);
  });

  it("scenario 3 — crash-after-rename: final present and complete, no leftover tmp", () => {
    // The rename succeeds (no fault armed). The post-rename invariant is that
    // a hypothetical crash immediately after rename(2) leaves the final file
    // fully present with exactly the new bytes and no temp artefact, because
    // rename(2) is atomic and the temp no longer exists once renamed.
    const csDir = join(workdir, "cs-post-rename");
    mkdirSync(csDir, { recursive: true });
    const csFile = join(csDir, "out.json");
    writeFileSync(csFile, "ORIGINAL");

    atomicWriteFile(csFile, '{"replaced":true}\n');
    expect(existsSync(csFile)).toBe(true);
    expect(readFileSync(csFile, "utf8")).toBe('{"replaced":true}\n');
    expect(leftoverTempFiles(csDir)).toEqual([]);

    const coreRoot = join(workdir, "core-post-rename");
    mkdirSync(coreRoot, { recursive: true });
    const coreFinal = join(coreRoot, "projects.json");
    coreWriteProject(coreRoot);
    expect(existsSync(coreFinal)).toBe(true);
    const written = readFileSync(coreFinal, "utf8");
    expect(written.endsWith("\n")).toBe(true);
    expect(JSON.parse(written)).toHaveLength(1); // final is complete + parseable
    expect(leftoverTempFiles(coreRoot)).toEqual([]);
  });

  it("scenario 4 — dir-symlink-attack: both refuse to write through a symlinked parent", () => {
    const realDir = join(workdir, "real");
    mkdirSync(realDir, { recursive: true });
    const linkDir = join(workdir, "link");
    symlinkSync(realDir, linkDir, "dir");

    expect(() => atomicWriteFile(join(linkDir, "out.json"), "x")).toThrow();

    const realCore = join(workdir, "real-core");
    mkdirSync(realCore, { recursive: true });
    const linkCore = join(workdir, "link-core");
    symlinkSync(realCore, linkCore, "dir");
    expect(() => coreWriteProject(linkCore)).toThrow();
  });

  it("scenario 5 — parent doesn't exist: both create it recursively then write", () => {
    const csFile = join(workdir, "cs", "nested", "deep", "out.json");
    atomicWriteFile(csFile, "data");
    expect(readFileSync(csFile, "utf8")).toBe("data");

    const coreRoot = join(workdir, "core-nested", "deep");
    coreWriteProject(coreRoot);
    expect(existsSync(join(coreRoot, "projects.json"))).toBe(true);
  });
});
