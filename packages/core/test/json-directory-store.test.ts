import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We must hoist vi.mock before any imports that use the mocked module.
// Vitest hoists vi.mock calls to the top of the file automatically.
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    // Re-export everything mutable so spies can override individual functions.
    renameSync: vi.fn(original.renameSync),
    writeFileSync: vi.fn(original.writeFileSync),
    rmSync: vi.fn(original.rmSync),
  };
});

// Import the mocked fs AFTER vi.mock so we get the mocked version.
import * as fsMock from "node:fs";
import { writeSessions } from "../src/json-directory-store.js";

const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
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
    // Reset all mocked functions to their real implementations before each test.
    vi.mocked(fsMock.renameSync).mockImplementation(fsMock.renameSync);
    vi.mocked(fsMock.writeFileSync).mockImplementation(fsMock.writeFileSync);
    vi.mocked(fsMock.rmSync).mockImplementation(fsMock.rmSync);
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

    const paths = {
      rootDir,
      projectsPath: join(rootDir, "projects.json"),
      sessionsPath,
      memoryDir: join(rootDir, "memory"),
    };

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

  it("does not leave a .tmp file when writeFileSync fails before rename", async () => {
    const sessionsPath = join(rootDir, "sessions.json");
    await writeFile(sessionsPath, "[]");

    // Make writeFileSync throw to simulate a disk-full or permission error.
    vi.mocked(fsMock.writeFileSync).mockImplementationOnce(() => {
      throw new Error("simulated write failure");
    });

    const paths = {
      rootDir,
      projectsPath: join(rootDir, "projects.json"),
      sessionsPath,
      memoryDir: join(rootDir, "memory"),
    };

    expect(() => writeSessions(paths, [])).toThrow();

    const files = fsMock.readdirSync(rootDir) as string[];
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });
});
