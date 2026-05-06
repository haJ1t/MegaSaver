import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatProjectLine,
  projectCreateCommand,
  projectListCommand,
} from "../src/commands/project.js";

describe("formatProjectLine", () => {
  it("renders id and name separated by exactly two spaces", () => {
    expect(
      formatProjectLine({
        id: "01HXYZ-aaaa-bbbb-cccc-dddddddddddd",
        name: "demo",
      }),
    ).toBe("01HXYZ-aaaa-bbbb-cccc-dddddddddddd  demo");
  });

  it("preserves whitespace inside name without quoting", () => {
    expect(
      formatProjectLine({
        id: "id1",
        name: "two words",
      }),
    ).toBe("id1  two words");
  });
});

describe("projectListCommand", () => {
  let root: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "megasaver-cli-list-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    await rm(root, { recursive: true, force: true });
  });

  async function runList(): Promise<void> {
    await projectListCommand.run?.({
      args: { store: root },
      cmd: projectListCommand,
      rawArgs: ["--store", root],
      data: undefined,
    } as never);
  }

  it("prints nothing on an empty store, exits 0, and notes first init", async () => {
    await runList();
    expect(logSpy).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0]?.[0] as string).toMatch(/^note: initialized store at /);
    expect(process.exitCode).toBe(0);
  });

  it("prints one line per project in projects.json array order", async () => {
    await mkdir(root, { recursive: true });
    const aId = "11111111-1111-4111-8111-111111111111";
    const bId = "22222222-2222-4222-8222-222222222222";
    const ts = "2026-05-06T00:00:00.000Z";
    await writeFile(
      join(root, "projects.json"),
      JSON.stringify([
        { id: aId, name: "alpha", rootPath: "/tmp/a", createdAt: ts, updatedAt: ts },
        { id: bId, name: "beta", rootPath: "/tmp/b", createdAt: ts, updatedAt: ts },
      ]),
    );
    await writeFile(join(root, "sessions.json"), "[]");

    await runList();

    expect(logSpy.mock.calls.map((c) => c[0])).toEqual([`${aId}  alpha`, `${bId}  beta`]);
    expect(errSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it("prints no init notice on the second run against the same store", async () => {
    await runList(); // first run initializes
    logSpy.mockClear();
    errSpy.mockClear();
    await runList(); // second run

    expect(logSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });
});

describe("projectCreateCommand", () => {
  let root: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "megasaver-cli-create-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    await rm(root, { recursive: true, force: true });
  });

  async function runCreate(name: string): Promise<void> {
    await projectCreateCommand.run?.({
      args: { name, store: root },
      cmd: projectCreateCommand,
      rawArgs: [name, "--store", root],
      data: undefined,
    } as never);
  }

  it("creates a project, prints `<id>  <name>` on stdout, and persists it", async () => {
    await runCreate("demo");

    expect(process.exitCode).toBe(0);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]?.[0] as string).toMatch(/^[0-9a-f-]{36} {2}demo$/);

    const persisted = JSON.parse(await readFile(join(root, "projects.json"), "utf8")) as Array<{
      id: string;
      name: string;
    }>;
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.name).toBe("demo");
  });

  it("emits the init notice exactly once on first invocation", async () => {
    await runCreate("demo");

    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0]?.[0] as string).toMatch(/^note: initialized store at /);
  });

  it("rejects an empty name with `error: name must be non-empty` and exit 1, without touching the store", async () => {
    await runCreate("   ");

    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.map((c) => c[0])).toEqual(["error: name must be non-empty"]);
    expect(logSpy).not.toHaveBeenCalled();

    // Implementation rejects the name before ensureStoreReady runs,
    // so projects.json must NOT have been created.
    await expect(readFile(join(root, "projects.json"), "utf8")).rejects.toThrow();
  });

  it("rejects a name containing control characters with the documented message", async () => {
    await runCreate("demo\nfake");

    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.map((c) => c[0])).toEqual([
      "error: name must not contain control characters",
    ]);
    expect(logSpy).not.toHaveBeenCalled();

    // Implementation rejects the name before ensureStoreReady runs,
    // so projects.json must NOT have been created.
    await expect(readFile(join(root, "projects.json"), "utf8")).rejects.toThrow();
  });

  it("rejects a duplicate name with the documented message and leaves projects.json unchanged", async () => {
    await runCreate("demo");
    logSpy.mockClear();
    errSpy.mockClear();
    process.exitCode = 0;

    await runCreate("demo");

    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.map((c) => c[0])).toEqual(['error: project "demo" already exists']);
    expect(logSpy).not.toHaveBeenCalled();

    const persisted = JSON.parse(await readFile(join(root, "projects.json"), "utf8")) as Array<{
      id: string;
      name: string;
    }>;
    expect(persisted).toHaveLength(1);
  });
});
