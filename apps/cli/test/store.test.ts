import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
    ).toBe(resolve("/repo", "local-store"));
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
    ).toBe(resolve("/xdg/data", "megasaver"));
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
    ).toBe(resolve("/home/user", ".local", "share", "megasaver"));
  });

  // NOTE: on a POSIX test host `node:path` uses posix separators even with
  // platform: "win32", so these assert BRANCH SELECTION (which base wins),
  // not the win32 separator — the real backslash output is proven by the
  // windows-latest CI leg (PR4). Both sides call the same `resolve`, and each
  // case asserts it differs from the other branches, so they are not tautological.
  it("win32 uses localAppData (not the home fallback, not posix)", () => {
    const out = resolveStorePath({
      storeFlag: undefined,
      cwd: "/repo",
      home: "C:\\Users\\u",
      xdgDataHome: undefined,
      platform: "win32",
      localAppData: "C:\\Users\\u\\AppData\\Local",
    });
    expect(out).toBe(resolve("C:\\Users\\u\\AppData\\Local", "megasaver"));
    // distinct from the posix-default branch (AppData\Local vs .local\share);
    // NOT compared to the home-AppData fallback — on a real win32 host those
    // two resolve to the SAME canonical path, so that would be a false assertion.
    expect(out).not.toBe(resolve("C:\\Users\\u", ".local", "share", "megasaver"));
  });

  it("win32 falls back to home/AppData/Local when localAppData unset", () => {
    const out = resolveStorePath({
      storeFlag: undefined,
      cwd: "/repo",
      home: "C:\\Users\\u",
      xdgDataHome: undefined,
      platform: "win32",
      localAppData: undefined,
    });
    expect(out).toBe(resolve("C:\\Users\\u", "AppData", "Local", "megasaver"));
    expect(out).not.toBe(resolve("C:\\Users\\u", ".local", "share", "megasaver"));
  });

  it("win32 throws when localAppData and home are both empty (no relative-path footgun)", () => {
    expect(() =>
      resolveStorePath({
        storeFlag: undefined,
        cwd: "/repo",
        home: "",
        xdgDataHome: undefined,
        platform: "win32",
        localAppData: undefined,
      }),
    ).toThrow();
  });

  it("win32 still honors an explicit XDG_DATA_HOME (documented opt-in)", () => {
    const out = resolveStorePath({
      storeFlag: undefined,
      cwd: "/repo",
      home: "C:\\Users\\u",
      xdgDataHome: "/xdg",
      platform: "win32",
      localAppData: "C:\\Users\\u\\AppData\\Local",
    });
    expect(out).toBe(resolve("/xdg", "megasaver"));
    expect(out).not.toBe(resolve("C:\\Users\\u\\AppData\\Local", "megasaver"));
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
