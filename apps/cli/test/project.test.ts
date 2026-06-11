import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { ProjectId } from "@megasaver/shared";
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
        id: "01HXYZ-aaaa-bbbb-cccc-dddddddddddd" as ProjectId,
        name: "demo",
      }),
    ).toBe("01HXYZ-aaaa-bbbb-cccc-dddddddddddd  demo");
  });

  it("preserves whitespace inside name without quoting", () => {
    expect(
      formatProjectLine({
        id: "id1" as ProjectId,
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
    expect(errSpy.mock.calls[0]?.[0] as string).toBe(`note: initialized store at ${root}`);
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

  it("--json on empty store emits `[]` on stdout and exits 0", async () => {
    await projectListCommand.run?.({
      args: { store: root, json: true },
      cmd: projectListCommand,
      rawArgs: ["--store", root, "--json"],
      data: undefined,
    } as never);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]?.[0]).toBe("[]");
    expect(process.exitCode).toBe(0);
  });

  it("--json with 2 projects emits compact JSON array with all 5 fields", async () => {
    await mkdir(root, { recursive: true });
    const aId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const bId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const ts = "2026-05-10T00:00:00.000Z";
    await writeFile(
      join(root, "projects.json"),
      JSON.stringify([
        { id: aId, name: "alpha", rootPath: "/tmp/a", createdAt: ts, updatedAt: ts },
        { id: bId, name: "beta", rootPath: "/tmp/b", createdAt: ts, updatedAt: ts },
      ]),
    );
    await writeFile(join(root, "sessions.json"), "[]");

    await projectListCommand.run?.({
      args: { store: root, json: true },
      cmd: projectListCommand,
      rawArgs: ["--store", root, "--json"],
      data: undefined,
    } as never);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0]?.[0] as string) as unknown[];
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({
      id: aId,
      name: "alpha",
      rootPath: "/tmp/a",
      createdAt: ts,
      updatedAt: ts,
    });
    expect(parsed[1]).toEqual({
      id: bId,
      name: "beta",
      rootPath: "/tmp/b",
      createdAt: ts,
      updatedAt: ts,
    });
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
    expect(errSpy.mock.calls[0]?.[0] as string).toBe(`note: initialized store at ${root}`);
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

  it("rejects a name containing a C1 control character (NEL) with the documented message", async () => {
    await runCreate("name\x85nel");

    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.map((c) => c[0])).toEqual([
      "error: name must not contain control characters",
    ]);
    expect(logSpy).not.toHaveBeenCalled();

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

  it("rejects NFD-equivalent of an existing NFC project name with the CLI duplicate message", async () => {
    // First create with NFC name: "café" where é is U+00E9 (precomposed).
    await runCreate("café");
    logSpy.mockClear();
    errSpy.mockClear();
    process.exitCode = 0;

    // Now try to create with NFD-equivalent: "café" where é is e + U+0301 (combining acute).
    // nameSchema normalizes both to NFC, so the CLI duplicate guard fires.
    await runCreate("café");

    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.some((c) => (c[0] as string).includes("already exists"))).toBe(true);
    expect(logSpy).not.toHaveBeenCalled();

    const persisted = JSON.parse(await readFile(join(root, "projects.json"), "utf8")) as Array<{
      id: string;
      name: string;
    }>;
    expect(persisted).toHaveLength(1);
  });

  it("stores rootPath from --root when an absolute path is given", async () => {
    await projectCreateCommand.run?.({
      args: { name: "demo", store: root, root: "/tmp/abs-root-test" },
      cmd: projectCreateCommand,
      rawArgs: ["demo", "--store", root, "--root", "/tmp/abs-root-test"],
      data: undefined,
    } as never);

    expect(process.exitCode).toBe(0);
    const persisted = JSON.parse(await readFile(join(root, "projects.json"), "utf8")) as Array<{
      rootPath: string;
    }>;
    expect(persisted[0]?.rootPath).toBe(resolve("/tmp/abs-root-test"));
  });

  it("resolves a relative --root to an absolute path", async () => {
    await projectCreateCommand.run?.({
      args: { name: "demo", store: root, root: "." },
      cmd: projectCreateCommand,
      rawArgs: ["demo", "--store", root, "--root", "."],
      data: undefined,
    } as never);

    expect(process.exitCode).toBe(0);
    const persisted = JSON.parse(await readFile(join(root, "projects.json"), "utf8")) as Array<{
      rootPath: string;
    }>;
    expect(persisted[0]?.rootPath).toBe(resolve("."));
    expect(isAbsolute(persisted[0]?.rootPath ?? "")).toBe(true);
  });

  it("stores process.cwd() as rootPath when --root is omitted (regression)", async () => {
    await runCreate("demo");

    expect(process.exitCode).toBe(0);
    const persisted = JSON.parse(await readFile(join(root, "projects.json"), "utf8")) as Array<{
      rootPath: string;
    }>;
    expect(persisted[0]?.rootPath).toBe(process.cwd());
  });

  it("resolves --root foo/bar (relative with subdir) to absolute path", async () => {
    await projectCreateCommand.run?.({
      args: { name: "demo", store: root, root: "foo/bar" },
      cmd: projectCreateCommand,
      rawArgs: ["demo", "--store", root, "--root", "foo/bar"],
      data: undefined,
    } as never);

    expect(process.exitCode).toBe(0);
    const persisted1 = JSON.parse(await readFile(join(root, "projects.json"), "utf8")) as Array<{
      rootPath: string;
    }>;
    expect(persisted1[0]?.rootPath).toBe(join(process.cwd(), "foo/bar"));
  });

  it("stores --root /nonexistent as-is without error (Option B: no fs check)", async () => {
    await projectCreateCommand.run?.({
      args: { name: "demo", store: root, root: "/nonexistent-path-gap4" },
      cmd: projectCreateCommand,
      rawArgs: ["demo", "--store", root, "--root", "/nonexistent-path-gap4"],
      data: undefined,
    } as never);

    expect(process.exitCode).toBe(0);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const persisted2 = JSON.parse(await readFile(join(root, "projects.json"), "utf8")) as Array<{
      rootPath: string;
    }>;
    expect(persisted2[0]?.rootPath).toBe(resolve("/nonexistent-path-gap4"));
  });

  it("treats --root '' (empty string) as process.cwd() via path.resolve semantics", async () => {
    await projectCreateCommand.run?.({
      args: { name: "demo", store: root, root: "" },
      cmd: projectCreateCommand,
      rawArgs: ["demo", "--store", root, "--root", ""],
      data: undefined,
    } as never);

    expect(process.exitCode).toBe(0);
    const persisted3 = JSON.parse(await readFile(join(root, "projects.json"), "utf8")) as Array<{
      rootPath: string;
    }>;
    expect(persisted3[0]?.rootPath).toBe(process.cwd());
  });

  it("--json emits compact JSON object with all 5 fields", async () => {
    await projectCreateCommand.run?.({
      args: { name: "demo", store: root, json: true },
      cmd: projectCreateCommand,
      rawArgs: ["demo", "--store", root, "--json"],
      data: undefined,
    } as never);

    expect(process.exitCode).toBe(0);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(parsed["name"]).toBe("demo");
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(typeof parsed["id"]).toBe("string");
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(parsed["rootPath"]).toBe(process.cwd());
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(typeof parsed["createdAt"]).toBe("string");
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(typeof parsed["updatedAt"]).toBe("string");
  });

  it("--json + --root emits JSON with resolved rootPath", async () => {
    await projectCreateCommand.run?.({
      args: { name: "demo", store: root, root: "/tmp/json-root-test", json: true },
      cmd: projectCreateCommand,
      rawArgs: ["demo", "--store", root, "--root", "/tmp/json-root-test", "--json"],
      data: undefined,
    } as never);

    expect(process.exitCode).toBe(0);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(parsed["rootPath"]).toBe(resolve("/tmp/json-root-test"));
  });
});
