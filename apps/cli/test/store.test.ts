import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureStoreReady, resolveStorePath } from "../src/store.js";

describe("resolveStorePath", () => {
  const home = "/home/user";

  it("returns absolute --store flag verbatim", () => {
    expect(
      resolveStorePath({
        storeFlag: "/abs/megasaver",
        cwd: "/repo",
        home,
        xdgDataHome: undefined,
      }),
    ).toBe("/abs/megasaver");
  });

  it("resolves a relative --store flag against cwd", () => {
    expect(
      resolveStorePath({
        storeFlag: "./local-store",
        cwd: "/repo",
        home,
        xdgDataHome: undefined,
      }),
    ).toBe("/repo/local-store");
  });

  it("rejects an empty --store flag", () => {
    expect(() =>
      resolveStorePath({
        storeFlag: "",
        cwd: "/repo",
        home,
        xdgDataHome: undefined,
      }),
    ).toThrow();
  });

  it("rejects a whitespace-only --store flag", () => {
    expect(() =>
      resolveStorePath({
        storeFlag: "   ",
        cwd: "/repo",
        home,
        xdgDataHome: undefined,
      }),
    ).toThrow();
  });

  it("uses XDG_DATA_HOME when set and non-empty", () => {
    expect(
      resolveStorePath({
        storeFlag: undefined,
        cwd: "/repo",
        home,
        xdgDataHome: "/xdg/data",
      }),
    ).toBe("/xdg/data/megasaver");
  });

  it("ignores empty XDG_DATA_HOME and falls back to HOME", () => {
    expect(
      resolveStorePath({
        storeFlag: undefined,
        cwd: "/repo",
        home,
        xdgDataHome: "",
      }),
    ).toBe("/home/user/.local/share/megasaver");
  });

  it("falls back to HOME when XDG_DATA_HOME is undefined", () => {
    expect(
      resolveStorePath({
        storeFlag: undefined,
        cwd: "/repo",
        home,
        xdgDataHome: undefined,
      }),
    ).toBe("/home/user/.local/share/megasaver");
  });

  it("flag wins even when XDG is set", () => {
    expect(
      resolveStorePath({
        storeFlag: "/abs/override",
        cwd: "/repo",
        home,
        xdgDataHome: "/xdg/data",
      }),
    ).toBe("/abs/override");
  });

  it("trims whitespace around the --store flag before resolving", () => {
    expect(
      resolveStorePath({
        storeFlag: "  /abs/with-spaces  ",
        cwd: "/repo",
        home,
        xdgDataHome: undefined,
      }),
    ).toBe("/abs/with-spaces");
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
    expect(await readFile(join(target, "projects.json"), "utf8")).toBe(
      '[{"id":"x","name":"y"}]',
    );
    const after = await stat(join(target, "projects.json"));
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it("reports initialized:true when a partial store is completed and preserves the existing file", async () => {
    const target = join(root, "partial");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "projects.json"), '[{"id":"x","name":"y"}]');

    const result = await ensureStoreReady(target);

    expect(result.initialized).toBe(true);
    expect(await readFile(join(target, "projects.json"), "utf8")).toBe(
      '[{"id":"x","name":"y"}]',
    );
    expect(await readFile(join(target, "sessions.json"), "utf8")).toBe("[]");
  });
});
