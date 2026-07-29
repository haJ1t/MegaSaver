import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveOverlayChunkSet } from "@megasaver/content-store";
import {
  appendOverlayEvent,
  readEvents,
  readOverlayEvents,
  readOverlaySummary,
} from "@megasaver/stats";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchChunk } from "../src/fetch-chunk.js";

const WK = "7da3a87ecc581dd6";
const LIVE = "ae662232-619e-4c84-b860-e38473ffa7ea";
const SET = "a9c9e447-d3d4-4251-abef-5773f8caafc2";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "megasaver-cg-expansion-"));
});
afterEach(() => rmSync(store, { recursive: true, force: true }));

async function seedOverlay(): Promise<void> {
  await saveOverlayChunkSet({
    storeRoot: store,
    chunkSet: {
      chunkSetId: SET,
      workspaceKey: WK,
      liveSessionId: LIVE,
      createdAt: "2026-07-09T12:00:00.000Z",
      source: { kind: "command", command: "pnpm verify", args: [] },
      rawBytes: 11,
      redacted: false,
      chunks: [{ id: "0", startLine: 1, endLine: 1, bytes: 11, text: "full output" }],
    },
  });
}

async function seedRegistry(): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const dir = join(store, "content", PROJECT_ID, SESSION_ID);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "cs-reg.json"),
    JSON.stringify({
      chunkSetId: "cs-reg",
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      createdAt: "2026-05-10T00:00:00.000Z",
      source: { kind: "file", path: "/tmp/demo/log.txt" },
      rawBytes: 13,
      redacted: false,
      chunks: [{ id: "0", startLine: 1, endLine: 1, bytes: 13, text: "second chunk\n" }],
    }),
  );
}

describe("fetchChunk — recovery debt (B3)", () => {
  it("a successful overlay fetch appends a signed expansion event", async () => {
    await seedOverlay();
    const out = await fetchChunk({ storeRoot: store, chunkSetId: SET, chunkId: "0" });
    expect(out.ok).toBe(true);

    const events = readOverlayEvents({ root: store }, WK, LIVE);
    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev?.kind).toBe("expansion");
    expect(ev?.chunkSetId).toBe(SET);
    expect(ev?.rawBytes).toBe(0);
    expect(ev?.returnedBytes).toBe(11);
    expect(ev?.bytesSaved).toBe(0);
    expect(ev?.deltaBytes).toBe(-11);
    expect(ev?.sourceKind).toBe("command");
  });

  it("net saving: compression credit minus expansion debit", async () => {
    await seedOverlay();
    appendOverlayEvent({
      store: { root: store },
      event: {
        id: "evt-compress-1",
        workspaceKey: WK,
        liveSessionId: LIVE,
        createdAt: "2026-07-09T12:00:00.000Z",
        sourceKind: "command",
        label: "pnpm verify",
        rawBytes: 1000,
        returnedBytes: 200,
        bytesSaved: 800,
        deltaBytes: 800,
        savingRatio: 0.8,
        chunkSetId: SET,
        summary: "s",
        mode: "balanced",
      },
      secretsRedacted: 0,
      chunksStored: 1,
    });
    await fetchChunk({ storeRoot: store, chunkSetId: SET, chunkId: "0" });

    const summary = readOverlaySummary({ root: store }, WK, LIVE);
    // Gross legacy field still credits the full compression…
    expect(summary?.bytesSavedTotal).toBe(800);
    // …but the signed aggregate is NET: 800 saved − 11 re-injected.
    expect(summary?.deltaBytesTotal).toBe(789);
  });

  it("a registry-layout fetch appends the expansion event to the registry log", async () => {
    await seedRegistry();
    const out = await fetchChunk({ storeRoot: store, chunkSetId: "cs-reg", chunkId: "0" });
    expect(out.ok).toBe(true);

    const events = readEvents({ root: store }, PROJECT_ID as never, SESSION_ID as never);
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("expansion");
    expect(events[0]?.deltaBytes).toBe(-13);
    expect(events[0]?.chunkSetId).toBe("cs-reg");
  });

  it("failed fetches record nothing", async () => {
    await seedOverlay();
    await fetchChunk({ storeRoot: store, chunkSetId: SET, chunkId: "9" });
    await fetchChunk({
      storeRoot: store,
      chunkSetId: "00000000-0000-4000-8000-000000000000",
      chunkId: "0",
    });
    expect(readOverlayEvents({ root: store }, WK, LIVE)).toHaveLength(0);
  });
});
