import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOverlayChunkSet } from "@megasaver/content-store";
import { readOverlayEvents, readOverlaySummary } from "@megasaver/stats";
import { afterEach, describe, expect, it } from "vitest";
import { recordAndFilterOverlayOutput } from "../src/record-output.js";

const WK = "0123456789abcdef";
const SID = "live-sess-1";

let root: string;
afterEach(() => {
  root = "";
});

function store(): string {
  root = mkdtempSync(join(tmpdir(), "ms-record-"));
  return root;
}

describe("recordAndFilterOverlayOutput", () => {
  it("compresses a large buffer, records an overlay event keyed by (wk, liveSessionId), stores a recoverable chunk", async () => {
    const storeRoot = store();
    const raw = `line ${"x".repeat(40)}\n`.repeat(2000);
    const res = await recordAndFilterOverlayOutput({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      raw,
      sourceKind: "command",
      label: "echo big",
      mode: "aggressive",
      storeRawOutput: true,
    });
    expect(res.decision).toBe("compressed");
    expect(res.returnedBytes).toBeLessThan(res.rawBytes);
    expect(res.bytesSaved).toBeGreaterThan(0);
    expect(res.chunkSetId).toBeTypeOf("string");

    const summary = readOverlaySummary({ root: storeRoot }, WK, SID);
    expect(summary?.eventsTotal).toBe(1);
    expect(summary?.bytesSavedTotal).toBe(res.bytesSaved);
    const events = readOverlayEvents({ root: storeRoot }, WK, SID);
    expect(events).toHaveLength(1);
    expect(events[0]?.liveSessionId).toBe(SID);
    expect(events[0]?.workspaceKey).toBe(WK);
    expect(events[0]?.sourceKind).toBe("command");

    const chunkPath = join(storeRoot, "content", WK, SID, `${res.chunkSetId}.json`);
    const chunk = JSON.parse(readFileSync(chunkPath, "utf8"));
    expect(chunk.chunks.length).toBeGreaterThan(0);
  });

  it("passes through (no event, no chunk) when output is below the mode budget", async () => {
    const storeRoot = store();
    const res = await recordAndFilterOverlayOutput({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      raw: "small output\n",
      sourceKind: "command",
      label: "echo small",
      mode: "safe",
      storeRawOutput: true,
    });
    expect(res.decision).toBe("passthrough");
    expect(res.chunkSetId).toBeUndefined();
    expect(readOverlaySummary({ root: storeRoot }, WK, SID)).toBeNull();
  });

  it("stores the FULL output (lossless): a marker buried in the middle is recoverable via expand", async () => {
    const storeRoot = store();
    const raw = `${"filler line\n".repeat(3000)}UNIQUE_MIDDLE_MARKER_9f3a\n${"filler line\n".repeat(3000)}`;
    const res = await recordAndFilterOverlayOutput({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      raw,
      sourceKind: "command",
      label: "echo middle",
      mode: "aggressive",
      storeRawOutput: true,
    });
    expect(res.decision).toBe("compressed");

    const cs = await loadOverlayChunkSet({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      // biome-ignore lint/style/noNonNullAssertion: decision === "compressed" guarantees chunkSetId
      chunkSetId: res.chunkSetId!,
    });
    const full = cs.chunks.map((c) => c.text).join("\n");
    expect(full).toContain("UNIQUE_MIDDLE_MARKER_9f3a");
    // Full output, not just the budget-fitted excerpts: the stored bytes far
    // exceed what was returned to the model, and the whole raw round-trips.
    expect(full).toBe(raw);
    expect(Buffer.byteLength(full, "utf8")).toBeGreaterThan(res.returnedBytes);
  });

  it("stores a chunk-set whose source matches the tool's sourceKind (command, not file)", async () => {
    const storeRoot = store();
    const raw = `line ${"x".repeat(40)}\n`.repeat(2000);
    const res = await recordAndFilterOverlayOutput({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      raw,
      sourceKind: "command",
      label: "echo big",
      mode: "aggressive",
      storeRawOutput: true,
    });
    expect(res.decision).toBe("compressed");

    const cs = await loadOverlayChunkSet({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      // biome-ignore lint/style/noNonNullAssertion: decision === "compressed" guarantees chunkSetId
      chunkSetId: res.chunkSetId!,
    });
    expect(cs.source.kind).toBe("command");
    expect(cs.source).toEqual({ kind: "command", command: "echo big", args: [] });
  });

  it("redacts secrets in the stored chunk and counts them in the summary", async () => {
    const storeRoot = store();
    const secret = "AKIAIOSFODNN7EXAMPLE";
    const raw = `${"filler line\n".repeat(3000)}${secret}\n${"filler line\n".repeat(3000)}`;
    const res = await recordAndFilterOverlayOutput({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      raw,
      sourceKind: "command",
      label: "echo secret",
      mode: "aggressive",
      storeRawOutput: true,
    });
    expect(res.decision).toBe("compressed");

    const summary = readOverlaySummary({ root: storeRoot }, WK, SID);
    expect(summary?.secretsRedactedTotal).toBeGreaterThan(0);

    const cs = await loadOverlayChunkSet({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      // biome-ignore lint/style/noNonNullAssertion: decision === "compressed" guarantees chunkSetId
      chunkSetId: res.chunkSetId!,
    });
    const full = cs.chunks.map((c) => c.text).join("\n");
    expect(full).not.toContain(secret);
    expect(cs.redacted).toBe(true);
  });

  // The source label is itself secret-bearing (full command line, fetch URL,
  // file path). Like the chunk CONTENT, it must be redacted before it is
  // persisted to the overlay chunk-set source AND the overlay stats event —
  // otherwise a credential in the command/URL lands unredacted on disk.
  const SECRET_BODY = "0123456789abcdefghijABCDEFGHIJ0123456789";
  const SECRET_TOKEN = `ghp_${SECRET_BODY}`;
  const bigRaw = (): string => `line ${"x".repeat(40)}\n`.repeat(2000);

  it("redacts the secret in a command label before persisting OverlayChunkSet.source", async () => {
    const storeRoot = store();
    const label = `curl https://api.github.com -H "Authorization: Bearer ${SECRET_TOKEN}"`;
    const res = await recordAndFilterOverlayOutput({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      raw: bigRaw(),
      sourceKind: "command",
      label,
      mode: "aggressive",
      storeRawOutput: true,
    });
    expect(res.decision).toBe("compressed");

    const cs = await loadOverlayChunkSet({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      // biome-ignore lint/style/noNonNullAssertion: decision === "compressed" guarantees chunkSetId
      chunkSetId: res.chunkSetId!,
    });
    const src = cs.source;
    if (src.kind !== "command") throw new Error("expected command source");
    expect(src.command).not.toContain(SECRET_BODY);
    // Readable, not blanked: the non-secret prefix survives, secret → marker.
    expect(src.command).toContain("curl https://api.github.com");
    expect(src.command).toContain("[REDACTED]");
  });

  it("redacts the secret in the overlay stats event label", async () => {
    const storeRoot = store();
    const label = `curl https://api.github.com -H "Authorization: Bearer ${SECRET_TOKEN}"`;
    const res = await recordAndFilterOverlayOutput({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      raw: bigRaw(),
      sourceKind: "command",
      label,
      mode: "aggressive",
      storeRawOutput: true,
    });
    expect(res.decision).toBe("compressed");

    const events = readOverlayEvents({ root: storeRoot }, WK, SID);
    expect(events).toHaveLength(1);
    expect(events[0]?.label).not.toContain(SECRET_BODY);
    expect(events[0]?.label).toContain("[REDACTED]");
  });

  it("redacts a token-bearing fetch URL label, keeping a schema-valid, readable source.url", async () => {
    const storeRoot = store();
    const label = `https://api.example.com/data?token=${SECRET_TOKEN}`;
    const res = await recordAndFilterOverlayOutput({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      raw: bigRaw(),
      sourceKind: "fetch",
      label,
      mode: "aggressive",
      storeRawOutput: true,
    });
    expect(res.decision).toBe("compressed");

    // Round-trips through loadOverlayChunkSet → the redacted URL still passes
    // the overlayChunkSetSchema z.string().url() guard (no schema_invalid throw).
    const cs = await loadOverlayChunkSet({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      // biome-ignore lint/style/noNonNullAssertion: decision === "compressed" guarantees chunkSetId
      chunkSetId: res.chunkSetId!,
    });
    const src = cs.source;
    if (src.kind !== "fetch") throw new Error("expected fetch source");
    expect(src.url).not.toContain(SECRET_BODY);
    expect(src.url).toContain("https://api.example.com/data");
    expect(src.url).toContain("[REDACTED]");
  });

  // The query-param secret has NO recognised prefix (the gap the redactor
  // hardening closes): proves url_query_secret redacts it on the persisted-on-
  // disk source.url AND the result still satisfies the z.string().url() guard.
  const OPAQUE_TOKEN = "deadbeefcafe0123456789abcdef0123";
  it("redacts a NON-prefixed query-token fetch URL on disk, staying schema-valid", async () => {
    const storeRoot = store();
    const res = await recordAndFilterOverlayOutput({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      raw: bigRaw(),
      sourceKind: "fetch",
      label: `https://api.example.com/data?api_key=${OPAQUE_TOKEN}`,
      mode: "aggressive",
      storeRawOutput: true,
    });
    expect(res.decision).toBe("compressed");

    const cs = await loadOverlayChunkSet({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      // biome-ignore lint/style/noNonNullAssertion: decision === "compressed" guarantees chunkSetId
      chunkSetId: res.chunkSetId!,
    });
    const src = cs.source;
    if (src.kind !== "fetch") throw new Error("expected fetch source");
    expect(src.url).not.toContain(OPAQUE_TOKEN);
    expect(src.url).toBe("https://api.example.com/data?api_key=[REDACTED]");
  });

  // grep + file lock the contract that chunkSetSource applies no per-kind
  // transform: every sourceKind redacts the single label, so a future refactor
  // splitting redaction per kind cannot silently regress query/path.
  it("redacts the secret in a grep query label before persisting source.query", async () => {
    const storeRoot = store();
    const res = await recordAndFilterOverlayOutput({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      raw: bigRaw(),
      sourceKind: "grep",
      label: `rg ${SECRET_TOKEN} src`,
      mode: "aggressive",
      storeRawOutput: true,
    });
    expect(res.decision).toBe("compressed");

    const cs = await loadOverlayChunkSet({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      // biome-ignore lint/style/noNonNullAssertion: decision === "compressed" guarantees chunkSetId
      chunkSetId: res.chunkSetId!,
    });
    const src = cs.source;
    if (src.kind !== "grep") throw new Error("expected grep source");
    expect(src.query).not.toContain(SECRET_BODY);
    expect(src.query).toContain("[REDACTED]");
  });

  it("redacts the secret in a file path label before persisting source.path", async () => {
    const storeRoot = store();
    const res = await recordAndFilterOverlayOutput({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      raw: bigRaw(),
      sourceKind: "file",
      label: `/tmp/${SECRET_TOKEN}/creds.env`,
      mode: "aggressive",
      storeRawOutput: true,
    });
    expect(res.decision).toBe("compressed");

    const cs = await loadOverlayChunkSet({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      // biome-ignore lint/style/noNonNullAssertion: decision === "compressed" guarantees chunkSetId
      chunkSetId: res.chunkSetId!,
    });
    const src = cs.source;
    if (src.kind !== "file") throw new Error("expected file source");
    expect(src.path).not.toContain(SECRET_BODY);
    expect(src.path).toContain("[REDACTED]");
  });
});

describe("multi-chunk overlay write (C12)", () => {
  it("splits a large raw into 40-line chunks with contiguous ranges and real ids", async () => {
    const storeRoot = store();
    // Padded so total bytes clear the hard-wrap token threshold (decision
    // must be "compressed", not "passthrough"/"light") while keeping exactly
    // 200 lines so the 40-line chunker produces exactly 5 chunks.
    const PAD = "x".repeat(40);
    const raw = Array.from({ length: 200 }, (_, i) => `line ${i + 1} content ${PAD}`).join("\n");
    const result = await recordAndFilterOverlayOutput({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      raw,
      sourceKind: "command",
      label: "pnpm verify",
      mode: "aggressive",
      storeRawOutput: true,
    });
    expect(result.decision).toBe("compressed");
    expect(result.chunkCount).toBe(5);
    const set = await loadOverlayChunkSet({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      // biome-ignore lint/style/noNonNullAssertion: decision === "compressed" guarantees chunkSetId
      chunkSetId: result.chunkSetId!,
    });
    expect(set.chunks).toHaveLength(5);
    expect(set.chunks.map((c) => c.id)).toEqual(["0", "1", "2", "3", "4"]);
    expect(set.chunks[0]).toMatchObject({ startLine: 1, endLine: 40 });
    expect(set.chunks[4]).toMatchObject({ startLine: 161, endLine: 200 });
    expect(set.chunks[2]?.text).toContain("line 81 content");
    expect(set.chunks[2]?.text).toContain("line 120 content");
    // Byte-exact recovery: concatenating all chunk texts with "\n" reproduces the raw.
    expect(set.chunks.map((c) => c.text).join("\n")).toBe(raw);
  });

  it("keeps a <=40-line raw as the single chunk 0 (regression)", async () => {
    const storeRoot = store();
    const raw = `${"x".repeat(6000)}\n${"y".repeat(6000)}`; // 2 lines, big bytes
    const result = await recordAndFilterOverlayOutput({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      raw,
      sourceKind: "command",
      label: "l",
      mode: "aggressive",
      storeRawOutput: true,
    });
    expect(result.chunkCount).toBe(1);
    const set = await loadOverlayChunkSet({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      // biome-ignore lint/style/noNonNullAssertion: decision === "compressed" guarantees chunkSetId
      chunkSetId: result.chunkSetId!,
    });
    expect(set.chunks.map((c) => c.id)).toEqual(["0"]);
  });

  it("omits chunkCount (and chunkSetId) on a compressed result when storeRawOutput is false", async () => {
    const storeRoot = store();
    const raw = `line ${"x".repeat(40)}\n`.repeat(2000);
    const result = await recordAndFilterOverlayOutput({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      raw,
      sourceKind: "command",
      label: "echo big",
      mode: "aggressive",
      storeRawOutput: false,
    });
    expect(result.decision).toBe("compressed");
    expect(result.chunkSetId).toBeUndefined();
    expect(result.chunkCount).toBeUndefined();
  });

  it("B8: a ~5KB aggressive output compresses (dead band closed)", async () => {
    const storeRoot = store();
    // 150 lines x ~34 chars ≈ 5.1 KB ≈ 1275 tokens: past the aggressive 4000 B
    // gate, but inside the old fixed 1200/2000 band -> "light" -> discarded.
    const raw = Array.from({ length: 150 }, (_, i) => `line ${i}: build noise xxxxxxxxxx`).join(
      "\n",
    );
    const r = await recordAndFilterOverlayOutput({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      raw,
      sourceKind: "command",
      label: "pnpm build",
      mode: "aggressive",
      storeRawOutput: true,
      compressFloorBytes: 4000,
    });
    expect(r.decision).toBe("compressed");
    expect(r.chunkSetId).toBeDefined();
  });

  it("B8: gate falls back to modeToBudget(mode) when compressFloorBytes is absent", async () => {
    const storeRoot = store();
    const raw = Array.from({ length: 150 }, (_, i) => `line ${i}: build noise xxxxxxxxxx`).join(
      "\n",
    );
    const r = await recordAndFilterOverlayOutput({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      raw,
      sourceKind: "command",
      label: "pnpm build",
      mode: "aggressive",
      storeRawOutput: true,
    });
    expect(r.decision).toBe("compressed");
  });

  it("B10: a file read reaches filterOutput with a file source (semantic chunking)", async () => {
    const storeRoot = store();
    // A function that CROSSES the blind 40-line wall: head at line 40, marker in
    // the body at line 46. Blind chunking splits head/body into different chunks
    // and budget pressure drops the body; semantic chunking keeps the function
    // whole, so the marker survives into returnedText.
    const filler = (n: number, tag: string, width = 80) =>
      Array.from({ length: n }, (_, i) => `// ${tag} filler line ${i} ${"x".repeat(width)}`);
    const lines = [
      ...filler(39, "head"),
      "function targetFn() {",
      ...filler(5, "body"),
      '  return "TARGET_BODY_MARKER";',
      "}",
      // Tripled tail width: budget pressure drops the blind body chunk so only
      // semantic chunking (function kept whole) preserves the marker.
      ...filler(260, "tail", 240),
    ];
    const raw = lines.join("\n");
    const r = await recordAndFilterOverlayOutput({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      raw,
      sourceKind: "file",
      label: "/Users/x/proj/src/target-module.ts",
      mode: "aggressive",
      storeRawOutput: true,
      compressFloorBytes: 4000,
      intent: "why does targetFn misbehave",
    });
    expect(r.decision).toBe("compressed");
    expect(r.returnedText).toContain("TARGET_BODY_MARKER");
  });
});
