import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireLock } from "../src/lock.js";

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "daemon-lock-"));
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
});

describe("acquireLock", () => {
  it("grants the lock to the first caller and refuses the second", () => {
    const release = acquireLock(store);
    expect(release).not.toBeNull();
    expect(acquireLock(store)).toBeNull();
  });

  it("releasing allows re-acquisition", () => {
    const release = acquireLock(store);
    expect(release).not.toBeNull();
    release?.();
    expect(acquireLock(store)).not.toBeNull();
  });
});
