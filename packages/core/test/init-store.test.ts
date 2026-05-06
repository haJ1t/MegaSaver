import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initStore } from "../src/init-store.js";

describe("initStore", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "megasaver-init-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("creates rootDir, projects.json, and sessions.json when nothing exists", async () => {
    const target = join(root, "store");
    await initStore(target);
    expect(await readFile(join(target, "projects.json"), "utf8")).toBe("[]");
    expect(await readFile(join(target, "sessions.json"), "utf8")).toBe("[]");
  });

  it("leaves an already-initialized store untouched (byte-identical)", async () => {
    const target = join(root, "store");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "projects.json"), '[{"id":"x","name":"y"}]');
    await writeFile(join(target, "sessions.json"), '[{"id":"a","projectId":"x"}]');

    await initStore(target);

    expect(await readFile(join(target, "projects.json"), "utf8")).toBe(
      '[{"id":"x","name":"y"}]',
    );
    expect(await readFile(join(target, "sessions.json"), "utf8")).toBe(
      '[{"id":"a","projectId":"x"}]',
    );
  });

  it("completes a partial store without overwriting the existing file", async () => {
    const target = join(root, "store");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "projects.json"), '[{"id":"x","name":"y"}]');

    await initStore(target);

    expect(await readFile(join(target, "projects.json"), "utf8")).toBe(
      '[{"id":"x","name":"y"}]',
    );
    expect(await readFile(join(target, "sessions.json"), "utf8")).toBe("[]");
  });

  it("is idempotent across two consecutive calls", async () => {
    const target = join(root, "store");
    await initStore(target);
    await initStore(target);
    expect(await readFile(join(target, "projects.json"), "utf8")).toBe("[]");
    expect(await readFile(join(target, "sessions.json"), "utf8")).toBe("[]");
  });
});
