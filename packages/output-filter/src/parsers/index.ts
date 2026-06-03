import { chunkByLines } from "../chunk.js";
import type { Chunk } from "../rank.js";
import { detectPytest, parsePytest } from "./pytest.js";
import { detectStacktrace, parseStacktrace } from "./stacktrace.js";
import { detectTestOutput, parseTestOutput } from "./test-output.js";
import { detectTsDiagnostic, parseTsDiagnostic } from "./ts-diagnostic.js";

const DEFAULT_LINES_PER_CHUNK = 40;

export function chunkByFormat(text: string): Chunk[] {
  if (detectPytest(text)) return parsePytest(text);
  if (detectTestOutput(text)) return parseTestOutput(text);
  if (detectTsDiagnostic(text)) return parseTsDiagnostic(text);
  if (detectStacktrace(text)) return parseStacktrace(text);
  return chunkByLines(text, DEFAULT_LINES_PER_CHUNK);
}
