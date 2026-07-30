import { chunkByLines } from "../chunk.js";
import type { Chunk } from "../rank.js";
import { detectCargoTest, parseCargoTest } from "./cargo-test.js";
import { detectEslint, parseEslint } from "./eslint.js";
import { detectGoTest, parseGoTest } from "./go-test.js";
import { detectPytest, parsePytest } from "./pytest.js";
import { chunkBySemantic } from "./semantic.js";
import { detectStacktrace, parseStacktrace } from "./stacktrace.js";
import { detectTestOutput, parseTestOutput } from "./test-output.js";
import { detectTsDiagnostic, parseTsDiagnostic } from "./ts-diagnostic.js";

const DEFAULT_LINES_PER_CHUNK = 40;

// Minimal shape the gate reads from the read's source. The full union lives
// in types.ts; only kind and (for files) path matter to chunk production.
export type FilterSource = { kind: string; path?: string };

// `diagnostic: true` marks parsers that emit one chunk per distinct diagnostic
// (eslint problem, pytest/go/cargo failure, stack frame). Those chunks are near
// enough for simhash to collapse, so filterOutput skips dedupe on them — same
// reason the typescript category is exempt. These outputs classify as
// generic_shell/unknown, so a parser-level flag (not classification.category)
// is what carries the exemption. test-output is vitest-like and stays deduped.
// `dropped` counts the segments a parser omitted before chunking (SC3-5) —
// invisible to the post-chunking dropped count unless reported here. Each such
// parser also emits an in-chunk counted marker naming the omission.
export async function chunkByFormatWithMeta(
  text: string,
  source?: FilterSource,
): Promise<{ chunks: Chunk[]; semantic: boolean; diagnostic: boolean; dropped: number }> {
  if (source?.kind === "file" && source.path !== undefined) {
    const semantic = await chunkBySemantic(text, source.path);
    if (semantic !== null) {
      return { chunks: semantic, semantic: true, diagnostic: false, dropped: 0 };
    }
  }
  if (detectPytest(text)) {
    return { chunks: parsePytest(text), semantic: false, diagnostic: true, dropped: 0 };
  }
  if (detectCargoTest(text)) {
    return { chunks: parseCargoTest(text), semantic: false, diagnostic: true, dropped: 0 };
  }
  if (detectGoTest(text)) {
    const parsed = parseGoTest(text);
    return { chunks: parsed.chunks, semantic: false, diagnostic: true, dropped: parsed.dropped };
  }
  if (detectEslint(text)) {
    return { chunks: parseEslint(text), semantic: false, diagnostic: true, dropped: 0 };
  }
  if (detectTestOutput(text)) {
    return { chunks: parseTestOutput(text), semantic: false, diagnostic: false, dropped: 0 };
  }
  if (detectTsDiagnostic(text)) {
    return { chunks: parseTsDiagnostic(text), semantic: false, diagnostic: true, dropped: 0 };
  }
  if (detectStacktrace(text)) {
    return { chunks: parseStacktrace(text), semantic: false, diagnostic: true, dropped: 0 };
  }
  return {
    chunks: chunkByLines(text, DEFAULT_LINES_PER_CHUNK),
    semantic: false,
    diagnostic: false,
    dropped: 0,
  };
}

export async function chunkByFormat(text: string, source?: FilterSource): Promise<Chunk[]> {
  return (await chunkByFormatWithMeta(text, source)).chunks;
}
