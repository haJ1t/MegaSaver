import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TranscriptEntry } from "../src/transcript.js";
import { appendTranscript, listTranscript } from "../src/transcript-store.js";

const WK = "0000000000000abc";
const AID = "11111111-1111-4111-8111-111111111111";
const AID2 = "22222222-2222-4222-8222-222222222222";

function mk(seq: number): TranscriptEntry {
  return {
    id: `33333333-3333-4333-8333-3333333333${String(seq).padStart(2, "0")}`,
    seq,
    ts: `2026-06-23T12:00:0${seq}.000Z`,
    role: "assistant",
    text: `entry ${seq}`,
  } as TranscriptEntry;
}

describe("transcript-store", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "tr-store-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("append then list returns entries ordered by ts then seq", async () => {
    await appendTranscript({ storeRoot: root, workspaceKey: WK, officeAgentId: AID, entry: mk(1) });
    await appendTranscript({ storeRoot: root, workspaceKey: WK, officeAgentId: AID, entry: mk(0) });
    const all = await listTranscript({ storeRoot: root, workspaceKey: WK, officeAgentId: AID });
    expect(all.map((e) => e.seq)).toEqual([0, 1]);
  });

  it("returns [] when the agent has no transcript yet", async () => {
    expect(await listTranscript({ storeRoot: root, workspaceKey: WK, officeAgentId: AID })).toEqual(
      [],
    );
  });

  it("isolates transcripts per agent", async () => {
    await appendTranscript({ storeRoot: root, workspaceKey: WK, officeAgentId: AID, entry: mk(0) });
    const other = await listTranscript({ storeRoot: root, workspaceKey: WK, officeAgentId: AID2 });
    expect(other).toEqual([]);
  });

  it("rejects an unsafe agent id segment", async () => {
    await expect(
      listTranscript({ storeRoot: root, workspaceKey: WK, officeAgentId: "../escape" }),
    ).rejects.toThrow();
  });
});
