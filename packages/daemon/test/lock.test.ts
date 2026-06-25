import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireLock } from "../src/lock.js";
import { describeUnlessWindows } from "./_platform.js";

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

describeUnlessWindows("acquireLock dir permissions", () => {
  let store: string;
  beforeEach(() => {
    store = mkdtempSync(join(tmpdir(), "daemon-lock-perm-"));
  });
  afterEach(() => {
    rmSync(store, { recursive: true, force: true });
  });

  // The CLI acquires the lock before the server writes discovery, so this is
  // the path that actually creates the daemon dir in production.
  it("creates the daemon dir with owner-only (0o700) permissions", () => {
    acquireLock(store);
    expect(statSync(join(store, "daemon")).mode & 0o777).toBe(0o700);
  });
});
