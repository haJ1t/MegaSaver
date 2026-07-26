import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasSeenOutput, hashToolOutput, recordSeenOutput } from "../src/saver-seen.js";

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "mega-seen-"));
});
afterEach(() => {
  vi.doUnmock("node:fs");
  vi.resetModules();
  rmSync(store, { recursive: true, force: true });
});

const WK = "wk1";
const SID = "sess-1";

describe("saver seen-hash ledger", () => {
  it("unseen → false; after record → true; different session → false", () => {
    const h = hashToolOutput("big tool output");
    expect(hasSeenOutput(store, WK, SID, h)).toBe(false);
    recordSeenOutput(store, WK, SID, h);
    expect(hasSeenOutput(store, WK, SID, h)).toBe(true);
    expect(hasSeenOutput(store, WK, "sess-2", h)).toBe(false);
  });

  it("hash is stable for identical content and differs for different content", () => {
    expect(hashToolOutput("a")).toBe(hashToolOutput("a"));
    expect(hashToolOutput("a")).not.toBe(hashToolOutput("b"));
  });

  it("caps the ledger at 500 hashes, evicting oldest first", () => {
    const first = hashToolOutput("first");
    recordSeenOutput(store, WK, SID, first);
    for (let i = 0; i < 500; i++) recordSeenOutput(store, WK, SID, hashToolOutput(`x${i}`));
    expect(hasSeenOutput(store, WK, SID, first)).toBe(false);
    expect(hasSeenOutput(store, WK, SID, hashToolOutput("x499"))).toBe(true);
  });

  it("corrupt ledger file reads as empty (fail-open: nothing seen)", () => {
    const h = hashToolOutput("a");
    recordSeenOutput(store, WK, SID, h);
    writeFileSync(join(store, "stats", WK, "saver-seen", `${SID}.json`), "{corrupt");
    expect(hasSeenOutput(store, WK, SID, h)).toBe(false);
  });

  it("fails open instead of reading while a writer holds the ledger lock", () => {
    const h = hashToolOutput("locked");
    recordSeenOutput(store, WK, SID, h);
    writeFileSync(join(store, "stats", WK, "saver-seen", `${SID}.json.lock`), "");

    expect(hasSeenOutput(store, WK, SID, h)).toBe(false);
  });

  it("does not depend on replacing the ledger file", async () => {
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    vi.doMock("node:fs", () => ({
      ...actual,
      renameSync() {
        throw new Error("injected Windows replacement denial");
      },
    }));
    vi.resetModules();
    const seen = await import("../src/saver-seen.js");
    const h = seen.hashToolOutput("no replacement needed");

    seen.recordSeenOutput(store, WK, SID, h);

    expect(seen.hasSeenOutput(store, WK, SID, h)).toBe(true);
  });
});
