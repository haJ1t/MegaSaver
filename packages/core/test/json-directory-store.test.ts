import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectIdSchema, sessionIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We must hoist vi.mock before any imports that use the mocked module.
// Vitest hoists vi.mock calls to the top of the file automatically.
// Hold real (un-mocked) fs functions so test impls can call them
// without recursing back through the mock proxy. vi.hoisted because
// vi.mock factory is hoisted above local module-level declarations.
const realFs = vi.hoisted(() => ({}) as { fns?: typeof import("node:fs") });

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  realFs.fns = original;
  return {
    ...original,
    // Re-export everything mutable so spies can override individual functions.
    renameSync: vi.fn(original.renameSync),
    writeFileSync: vi.fn(original.writeFileSync),
    rmSync: vi.fn(original.rmSync),
    fsyncSync: vi.fn(original.fsyncSync),
    openSync: vi.fn(original.openSync),
    closeSync: vi.fn(original.closeSync),
  };
});

// Import the mocked fs AFTER vi.mock so we get the mocked version.
import * as fsMock from "node:fs";
import { resolveStorePaths, writeSessions } from "../src/json-directory-store.js";

const SESSION_ID = sessionIdSchema.parse("22222222-2222-4222-8222-222222222222");
const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const TS = "2026-05-09T00:00:00.000Z";

const VALID_SESSION = {
  id: SESSION_ID,
  projectId: PROJECT_ID,
  agentId: "claude-code" as const,
  riskLevel: "medium" as const,
  title: "original title",
  startedAt: TS,
  endedAt: null,
};

describe("atomicWriteFile — partial-write recovery (V2)", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "megasaver-core-store-v2-"));
    // Reset all mocked functions to the real (un-mocked) implementations.
    const real = realFs.fns;
    if (!real) throw new Error("realFs.fns not initialised");
    vi.mocked(fsMock.renameSync).mockImplementation(real.renameSync);
    vi.mocked(fsMock.writeFileSync).mockImplementation(real.writeFileSync);
    vi.mocked(fsMock.rmSync).mockImplementation(real.rmSync);
    vi.mocked(fsMock.fsyncSync).mockImplementation(real.fsyncSync);
    vi.mocked(fsMock.openSync).mockImplementation(real.openSync);
    vi.mocked(fsMock.closeSync).mockImplementation(real.closeSync);
  });

  afterEach(async () => {
    vi.resetAllMocks();
    await rm(rootDir, { recursive: true, force: true });
  });

  it("preserves original file when renameSync throws after writeFileSync", async () => {
    const sessionsPath = join(rootDir, "sessions.json");
    const originalContent = `${JSON.stringify([VALID_SESSION], null, 2)}\n`;

    // Seed the file with the original content.
    await writeFile(sessionsPath, originalContent);

    // Make renameSync throw to simulate a crash between temp-write and atomic rename.
    vi.mocked(fsMock.renameSync).mockImplementationOnce(() => {
      throw new Error("simulated rename failure");
    });

    const paths = { ...resolveStorePaths(rootDir), sessionsPath };

    const updatedSession = { ...VALID_SESSION, title: "new title" };
    expect(() => writeSessions(paths, [updatedSession])).toThrow();

    // The original file must be unchanged.
    const afterContent = await readFile(sessionsPath, "utf8");
    expect(afterContent).toBe(originalContent);

    // No stale .tmp file should remain in the directory.
    const files = fsMock.readdirSync(rootDir) as string[];
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });

  it("fsyncs the temp file before rename and the parent dir after rename", async () => {
    const sessionsPath = join(rootDir, "sessions.json");
    await writeFile(sessionsPath, "[]");

    const callOrder: string[] = [];
    const real = realFs.fns;
    if (!real) throw new Error("realFs.fns not initialised");
    const realOpen = real.openSync;
    const realFsync = real.fsyncSync;
    const realRename = real.renameSync;
    const realClose = real.closeSync;

    // Track every (call, path) pair so we can assert the temp-fsync,
    // rename, dir-fsync ordering required by POSIX best practice.
    const fdToPath = new Map<number, string>();
    vi.mocked(fsMock.openSync).mockImplementation(((
      path: Parameters<typeof realOpen>[0],
      ...rest: unknown[]
    ) => {
      const fd = (realOpen as (...a: unknown[]) => number)(path, ...rest);
      fdToPath.set(fd, String(path));
      callOrder.push(`open:${String(path)}`);
      return fd;
    }) as typeof realOpen);
    vi.mocked(fsMock.fsyncSync).mockImplementation(((fd: number) => {
      callOrder.push(`fsync:${fdToPath.get(fd) ?? "?"}`);
      return realFsync(fd);
    }) as typeof realFsync);
    vi.mocked(fsMock.renameSync).mockImplementation(((
      src: Parameters<typeof realRename>[0],
      dst: Parameters<typeof realRename>[1],
    ) => {
      callOrder.push(`rename:${String(src)}->${String(dst)}`);
      return realRename(src, dst);
    }) as typeof realRename);
    vi.mocked(fsMock.closeSync).mockImplementation(((fd: number) => {
      callOrder.push(`close:${fdToPath.get(fd) ?? "?"}`);
      return realClose(fd);
    }) as typeof realClose);

    const paths = { ...resolveStorePaths(rootDir), sessionsPath };

    writeSessions(paths, [VALID_SESSION]);

    // Find indices of the key events.
    const tempOpen = callOrder.findIndex((e) => e.startsWith("open:") && e.includes(".tmp"));
    const tempFsync = callOrder.findIndex((e) => e.startsWith("fsync:") && e.includes(".tmp"));
    const renameIdx = callOrder.findIndex((e) => e.startsWith("rename:"));
    const dirOpen = callOrder.findIndex((e, i) => i > renameIdx && e === `open:${rootDir}`);
    const dirFsync = callOrder.findIndex((e, i) => i > renameIdx && e === `fsync:${rootDir}`);

    expect(tempOpen, `expected temp file open: ${callOrder.join(",")}`).toBeGreaterThanOrEqual(0);
    expect(tempFsync, `expected temp fsync: ${callOrder.join(",")}`).toBeGreaterThan(tempOpen);
    expect(renameIdx, `expected rename: ${callOrder.join(",")}`).toBeGreaterThan(tempFsync);
    // The parent-dir fsync is POSIX-only — on win32 it is skipped by design
    // (NTFS journals rename metadata; the dedicated win32-skip test below pins
    // that). So assert its presence on POSIX and its ABSENCE on Windows.
    if (process.platform === "win32") {
      expect(dirOpen, `expected NO dir open after rename on win32: ${callOrder.join(",")}`).toBe(
        -1,
      );
    } else {
      expect(dirOpen, `expected dir open after rename: ${callOrder.join(",")}`).toBeGreaterThan(
        renameIdx,
      );
      expect(dirFsync, `expected dir fsync after rename: ${callOrder.join(",")}`).toBeGreaterThan(
        dirOpen,
      );
    }
  });

  it("does not leave a .tmp file when writeFileSync fails before rename", async () => {
    const sessionsPath = join(rootDir, "sessions.json");
    await writeFile(sessionsPath, "[]");

    // Make writeFileSync throw to simulate a disk-full or permission error.
    vi.mocked(fsMock.writeFileSync).mockImplementationOnce(() => {
      throw new Error("simulated write failure");
    });

    const paths = { ...resolveStorePaths(rootDir), sessionsPath };

    expect(() => writeSessions(paths, [])).toThrow();

    const files = fsMock.readdirSync(rootDir) as string[];
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });
});

describe("atomicWriteFile — Windows path (GG)", () => {
  // NTFS journals metadata operations on rename; FlushFileBuffers on a
  // directory handle is a documented no-op. We assert the win32 branch
  // skips the post-rename directory fsync entirely (no openSync on the
  // parent dir, no second fsyncSync call) while keeping the temp-file
  // fsync intact. Stub via Object.defineProperty(process, "platform")
  // + vi.resetModules() + dynamic import so the module-level
  // IS_WIN32 constant is captured under the stubbed platform.
  let rootDir: string;
  const ORIGINAL_PLATFORM = process.platform;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "megasaver-core-store-gg-"));
    const real = realFs.fns;
    if (!real) throw new Error("realFs.fns not initialised");
    vi.mocked(fsMock.renameSync).mockImplementation(real.renameSync);
    vi.mocked(fsMock.writeFileSync).mockImplementation(real.writeFileSync);
    vi.mocked(fsMock.rmSync).mockImplementation(real.rmSync);
    vi.mocked(fsMock.fsyncSync).mockImplementation(real.fsyncSync);
    vi.mocked(fsMock.openSync).mockImplementation(real.openSync);
    vi.mocked(fsMock.closeSync).mockImplementation(real.closeSync);
  });

  afterEach(async () => {
    Object.defineProperty(process, "platform", { value: ORIGINAL_PLATFORM });
    vi.resetAllMocks();
    vi.resetModules();
    await rm(rootDir, { recursive: true, force: true });
  });

  it("skips the parent-dir fsync when process.platform === 'win32'", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    vi.resetModules();

    const callOrder: string[] = [];
    const real = realFs.fns;
    if (!real) throw new Error("realFs.fns not initialised");
    const realOpen = real.openSync;
    const realFsync = real.fsyncSync;
    const realRename = real.renameSync;
    const realClose = real.closeSync;

    const fdToPath = new Map<number, string>();
    vi.mocked(fsMock.openSync).mockImplementation(((
      path: Parameters<typeof realOpen>[0],
      ...rest: unknown[]
    ) => {
      const fd = (realOpen as (...a: unknown[]) => number)(path, ...rest);
      fdToPath.set(fd, String(path));
      callOrder.push(`open:${String(path)}`);
      return fd;
    }) as typeof realOpen);
    vi.mocked(fsMock.fsyncSync).mockImplementation(((fd: number) => {
      callOrder.push(`fsync:${fdToPath.get(fd) ?? "?"}`);
      return realFsync(fd);
    }) as typeof realFsync);
    vi.mocked(fsMock.renameSync).mockImplementation(((
      src: Parameters<typeof realRename>[0],
      dst: Parameters<typeof realRename>[1],
    ) => {
      callOrder.push(`rename:${String(src)}->${String(dst)}`);
      return realRename(src, dst);
    }) as typeof realRename);
    vi.mocked(fsMock.closeSync).mockImplementation(((fd: number) => {
      callOrder.push(`close:${fdToPath.get(fd) ?? "?"}`);
      return realClose(fd);
    }) as typeof realClose);

    // Re-import under the stubbed platform so the module's IS_WIN32
    // constant is captured as true.
    const { writeSessions: writeSessionsWin32 } = await import("../src/json-directory-store.js");

    const sessionsPath = join(rootDir, "sessions.json");
    const paths = { ...resolveStorePaths(rootDir), sessionsPath };

    writeSessionsWin32(paths, [VALID_SESSION]);

    const tempOpens = callOrder.filter((e) => e.startsWith("open:") && e.includes(".tmp"));
    const tempFsyncs = callOrder.filter((e) => e.startsWith("fsync:") && e.includes(".tmp"));
    const dirOpens = callOrder.filter((e) => e === `open:${rootDir}`);
    const dirFsyncs = callOrder.filter((e) => e === `fsync:${rootDir}`);
    const renames = callOrder.filter((e) => e.startsWith("rename:"));

    expect(tempOpens, `expected temp file open: ${callOrder.join(",")}`).toHaveLength(1);
    expect(tempFsyncs, `expected temp fsync: ${callOrder.join(",")}`).toHaveLength(1);
    expect(renames, `expected rename: ${callOrder.join(",")}`).toHaveLength(1);
    expect(dirOpens, `expected NO parent-dir open on win32: ${callOrder.join(",")}`).toHaveLength(
      0,
    );
    expect(dirFsyncs, `expected NO parent-dir fsync on win32: ${callOrder.join(",")}`).toHaveLength(
      0,
    );
  });
});
