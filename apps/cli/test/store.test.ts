import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureStoreReady, resolveStorePath } from "../src/store.js";

const POSIX = { platform: "linux" as const, localAppData: undefined };

describe("resolveStorePath", () => {
  it("override absolute is returned verbatim", () => {
    expect(
      resolveStorePath({
        storeFlag: "/abs/megasaver",
        cwd: "/repo",
        home: "/home/user",
        xdgDataHome: undefined,
        ...POSIX,
      }),
    ).toBe("/abs/megasaver");
  });

  it("override relative resolves against cwd", () => {
    expect(
      resolveStorePath({
        storeFlag: "local-store",
        cwd: "/repo",
        home: "/home/user",
        xdgDataHome: undefined,
        ...POSIX,
      }),
    ).toBe(join("/repo", "local-store"));
  });

  it("XDG_DATA_HOME honored on posix", () => {
    expect(
      resolveStorePath({
        storeFlag: undefined,
        cwd: "/repo",
        home: "/home/user",
        xdgDataHome: "/xdg/data",
        ...POSIX,
      }),
    ).toBe(join("/xdg/data", "megasaver"));
  });

  it("posix default falls back to ~/.local/share", () => {
    expect(
      resolveStorePath({
        storeFlag: undefined,
        cwd: "/repo",
        home: "/home/user",
        xdgDataHome: undefined,
        ...POSIX,
      }),
    ).toBe(join("/home/user", ".local", "share", "megasaver"));
  });

  it("win32 default uses localAppData", () => {
    expect(
      resolveStorePath({
        storeFlag: undefined,
        cwd: "C:\\repo",
        home: "C:\\Users\\u",
        xdgDataHome: undefined,
        platform: "win32",
        localAppData: "C:\\Users\\u\\AppData\\Local",
      }),
    ).toBe(join("C:\\Users\\u\\AppData\\Local", "megasaver"));
  });

  it("win32 default falls back to home/AppData/Local when localAppData unset", () => {
    expect(
      resolveStorePath({
        storeFlag: undefined,
        cwd: "C:\\repo",
        home: "C:\\Users\\u",
        xdgDataHome: undefined,
        platform: "win32",
        localAppData: undefined,
      }),
    ).toBe(join("C:\\Users\\u", "AppData", "Local", "megasaver"));
  });

  it("win32 still honors an explicit XDG_DATA_HOME (documented opt-in)", () => {
    expect(
      resolveStorePath({
        storeFlag: undefined,
        cwd: "C:\\repo",
        home: "C:\\Users\\u",
        xdgDataHome: "D:\\xdg",
        platform: "win32",
        localAppData: "C:\\Users\\u\\AppData\\Local",
      }),
    ).toBe(join("D:\\xdg", "megasaver"));
  });
});

describe("ensureStoreReady", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "megasaver-cli-store-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("creates the layout when rootDir does not exist and reports initialized:true", async () => {
    const target = join(root, "fresh");
    const result = await ensureStoreReady(target);
    expect(result.initialized).toBe(true);
    expect(await readFile(join(target, "projects.json"), "utf8")).toBe("[]");
    expect(await readFile(join(target, "sessions.json"), "utf8")).toBe("[]");
    expect(result.registry).toBeDefined();
  });

  it("reports initialized:false against an already-complete store and does not mutate", async () => {
    const target = join(root, "complete");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "projects.json"), '[{"id":"x","name":"y"}]');
    await writeFile(join(target, "sessions.json"), "[]");
    const before = await stat(join(target, "projects.json"));

    const result = await ensureStoreReady(target);

    expect(result.initialized).toBe(false);
    expect(await readFile(join(target, "projects.json"), "utf8")).toBe('[{"id":"x","name":"y"}]');
    const after = await stat(join(target, "projects.json"));
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it("reports initialized:true when a partial store is completed and preserves the existing file", async () => {
    const target = join(root, "partial");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "projects.json"), '[{"id":"x","name":"y"}]');

    const result = await ensureStoreReady(target);

    expect(result.initialized).toBe(true);
    expect(await readFile(join(target, "projects.json"), "utf8")).toBe('[{"id":"x","name":"y"}]');
    expect(await readFile(join(target, "sessions.json"), "utf8")).toBe("[]");
  });
});
