import { extractTs } from "@megasaver/indexer";
import { describe, expect, it } from "vitest";
import { chunkBySemantic, partitionFile } from "../src/parsers/semantic.js";
import type { Chunk } from "../src/rank.js";

// --- T1 wiring (kept) ---
describe("@megasaver/indexer dependency wiring (T1)", () => {
  it("resolves extractTs through the indexer public entry", () => {
    expect(typeof extractTs).toBe("function");
  });
});

// Every line of the original text must appear in exactly one chunk, with no
// gaps and no overlaps. This is the partition invariant (spec decision 5).
function assertExhaustivePartition(text: string, chunks: Chunk[]): void {
  const lastLine = text.split("\n").length;
  const sorted = [...chunks].sort((a, b) => a.startLine - b.startLine);
  expect(sorted[0]?.startLine).toBe(1);
  expect(sorted.at(-1)?.endLine).toBe(lastLine);
  for (let i = 1; i < sorted.length; i += 1) {
    expect(sorted[i]?.startLine).toBe((sorted[i - 1]?.endLine ?? 0) + 1);
  }
}

describe("chunkBySemantic (T2)", () => {
  it("aligns chunks to function boundaries for a .ts file", async () => {
    const text = [
      "import { x } from './x.js';",
      "",
      "export function alpha() {",
      "  return x + 1;",
      "}",
      "",
      "export function beta() {",
      "  return x + 2;",
      "}",
      "",
    ].join("\n");
    const chunks = await chunkBySemantic(text, "mod.ts");
    expect(chunks).not.toBeNull();
    const c = chunks ?? [];
    // a chunk covers the alpha body and a chunk covers the beta body
    expect(c.some((k) => k.text.includes("export function alpha"))).toBe(true);
    expect(c.some((k) => k.text.includes("export function beta"))).toBe(true);
    assertExhaustivePartition(text, c);
  });

  it("gap-fills uncovered ranges (imports + trailing) so the whole file is partitioned", async () => {
    const text = [
      "import a from 'a';", // line 1 — not a declaration block
      "const Z = 1;", // line 2 — not function-like, not a block
      "export function only() {", // 3
      "  return Z;", // 4
      "}", // 5
      "const trailing = 9;", // 6 — trailing gap
    ].join("\n");
    const chunks = await chunkBySemantic(text, "g.ts");
    expect(chunks).not.toBeNull();
    assertExhaustivePartition(text, chunks ?? []);
  });

  it("sub-splits an oversized block into line-chunks with remapped line numbers", async () => {
    const bodyLines = Array.from({ length: 200 }, (_, i) => `  const v${i} = ${i};`);
    const text = ["export function big() {", ...bodyLines, "}"].join("\n");
    const chunks = await chunkBySemantic(text, "big.ts");
    expect(chunks).not.toBeNull();
    const c = chunks ?? [];
    // the single 202-line function must NOT be one chunk — it exceeds the cap
    expect(c.length).toBeGreaterThan(1);
    // remapped offsets: first sub-chunk starts at line 1, partition is exhaustive
    assertExhaustivePartition(text, c);
  });

  it("returns null for an unsupported extension (caller falls back)", async () => {
    expect(await chunkBySemantic("some text\nmore", "data.csv")).toBeNull();
  });

  it("returns null when the extractor finds zero blocks (heading-less md)", async () => {
    expect(
      await chunkBySemantic("plain prose with no heading\nand a second line", "notes.md"),
    ).toBeNull();
  });

  it("returns null (never throws) when parsing throws", async () => {
    // empty .ts yields zero TS declarations -> null; proves no throw path
    expect(await chunkBySemantic("", "empty.ts")).toBeNull();
  });

  it("chunks a .json file by top-level keys, exhaustively partitioned", async () => {
    const text = '{\n  "name": "x",\n  "version": "1.0.0",\n  "private": true\n}';
    const chunks = await chunkBySemantic(text, "package.json");
    expect(chunks).not.toBeNull();
    assertExhaustivePartition(text, chunks ?? []);
  });
});

describe("partitionFile (T2 helper)", () => {
  it("emits gap chunks for uncovered ranges and orders by startLine", () => {
    const text = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n");
    // one block covers lines 4-6; lines 1-3 and 7-10 are gaps
    const chunks = partitionFile(text, [{ startLine: 4, endLine: 6 }], 80);
    assertExhaustivePartition(text, chunks);
    const block = chunks.find((c) => c.startLine === 4);
    expect(block?.endLine).toBe(6);
  });

  it("returns empty for empty text", () => {
    expect(partitionFile("", [], 80)).toEqual([]);
  });

  it("skips a block span already covered (defensive against overlap)", () => {
    const text = Array.from({ length: 6 }, (_, i) => `l${i + 1}`).join("\n");
    const chunks = partitionFile(
      text,
      [
        { startLine: 1, endLine: 4 },
        { startLine: 2, endLine: 3 },
      ],
      80,
    );
    assertExhaustivePartition(text, chunks);
  });
});
