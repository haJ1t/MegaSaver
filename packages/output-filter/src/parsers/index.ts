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

export function chunkByFormatWithMeta(
  text: string,
  source?: FilterSource,
): { chunks: Chunk[]; semantic: boolean } {
  if (source?.kind === "file" && source.path !== undefined) {
    const semantic = chunkBySemantic(text, source.path);
    if (semantic !== null) return { chunks: semantic, semantic: true };
  }
  if (detectPytest(text)) return { chunks: parsePytest(text), semantic: false };
  if (detectCargoTest(text)) return { chunks: parseCargoTest(text), semantic: false };
  if (detectGoTest(text)) return { chunks: parseGoTest(text), semantic: false };
  if (detectEslint(text)) return { chunks: parseEslint(text), semantic: false };
  if (detectTestOutput(text)) return { chunks: parseTestOutput(text), semantic: false };
  if (detectTsDiagnostic(text)) return { chunks: parseTsDiagnostic(text), semantic: false };
  if (detectStacktrace(text)) return { chunks: parseStacktrace(text), semantic: false };
  return { chunks: chunkByLines(text, DEFAULT_LINES_PER_CHUNK), semantic: false };
}

export function chunkByFormat(text: string, source?: FilterSource): Chunk[] {
  return chunkByFormatWithMeta(text, source).chunks;
}
