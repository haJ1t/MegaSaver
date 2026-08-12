import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readDisclosureReceipt,
  writeDisclosureReceipt,
} from "../src/commands/session/disclosure/receipt-store.js";

const RECEIPT = {
  sessionId: "0f8fad5b-d9cb-469f-a165-70867728950e",
  generatedAt: "2026-08-06T12:00:00.000Z",
  claimed: ["src/a.ts"],
  observed: ["src/a.ts", "pnpm-lock.yaml"],
  undisclosed: ["pnpm-lock.yaml"],
  phantom: [],
  droppedCandidates: 1,
  inputBytes: 2048,
};

describe("disclosure receipt store", () => {
  let root = "";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "megasaver-disclosure-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("round-trips atomically with no tmp residue", async () => {
    writeDisclosureReceipt(root, RECEIPT);
    expect(readDisclosureReceipt(root, RECEIPT.sessionId)).toEqual(RECEIPT);
    const entries = await readdir(join(root, "disclosure"));
    expect(entries).toEqual([`${RECEIPT.sessionId}.json`]);
  });

  it("reads missing and malformed receipts as null", async () => {
    expect(readDisclosureReceipt(root, RECEIPT.sessionId)).toBeNull();
    writeDisclosureReceipt(root, RECEIPT);
    await writeFile(join(root, "disclosure", `${RECEIPT.sessionId}.json`), "{not json");
    expect(readDisclosureReceipt(root, RECEIPT.sessionId)).toBeNull();
  });
});
