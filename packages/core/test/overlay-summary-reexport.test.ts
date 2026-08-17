import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readOverlaySummary } from "../src/index.js";

const WK = "0123456789abcdef";
const LSID = "22222222-2222-4222-8222-222222222222";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "core-overlay-summary-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("readOverlaySummary re-export", () => {
  it("reads a valid overlay summary through the core surface", () => {
    const dir = join(root, "stats", WK);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${LSID}.json`),
      JSON.stringify({
        liveSessionId: LSID,
        eventsTotal: 3,
        rawBytesTotal: 3000,
        returnedBytesTotal: 600,
        bytesSavedTotal: 2400,
        savingRatio: 0.8,
        secretsRedactedTotal: 0,
        chunksStoredTotal: 3,
        updatedAt: "2026-08-01T12:00:00.000Z",
      }),
    );
    const summary = readOverlaySummary({ root }, WK, LSID);
    expect(summary?.liveSessionId).toBe(LSID);
    expect(summary?.eventsTotal).toBe(3);
  });
});
