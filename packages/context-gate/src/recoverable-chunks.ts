import type { ChunkSet } from "@megasaver/content-store";
import { chunkByLines, normalize } from "@megasaver/output-filter";
import { redact } from "@megasaver/policy";
import { OVERLAY_CHUNK_LINES } from "./recovery-footer.js";

// A2 (spec 2026-07-28-saver-compression-integrity §W2): the single source of
// recovery content for every entry point.
//
// The four persistence sinks disagreed. The hook path chunked the full redacted
// output; read and both exec paths chunked `filtered.excerpts` — the excerpts
// the fit step had already decided to KEEP. Whatever fitBudget dropped was
// therefore written nowhere, while the connector block advertised "Raw output is
// stored" on exactly those paths. Measured by the A1 contract at 960-1360 lines
// lost per case.
//
// Recovery chunks are derived from the raw output and nothing else. They are
// deliberately NOT derived from the filter result: any input that has passed
// through ranking has already had the decision applied to it, and a sink that
// re-derives recovery from a post-decision value can only ever store what
// survived. That is the whole defect.
export function recoverableChunks(raw: string): ChunkSet["chunks"] {
  const { redacted } = redact(raw);
  // Chunks index NORMALIZED text because the delivered gap markers do: the
  // filter numbers them off `normalize(redacted)` (output-filter types.ts).
  // `normalize` does not preserve line count — a bare CR becomes a newline,
  // and a multi-line OSC escape is deleted whole — so chunking the raw
  // redacted output put the two sides in different coordinate systems.
  // Measured on 400 npm-style progress-bar redraws: markers named line 1600
  // while the stored chunks ended at 800 and the footer advertised i = 0..19,
  // so the published ~40-lines-per-chunk rule resolved the marker past the
  // last chunk that existed.
  //
  // The stored text is therefore ANSI-stripped and right-trimmed as well.
  // Neither carries evidence, and the delivered excerpts were already
  // normalized, so nothing recoverable is lost that an agent could act on.
  const normalized = normalize(redacted);
  // An empty output still gets one chunk: the recovery footer advertises
  // `i = 0..N-1`, and N = 0 would advertise a range that cannot be fetched.
  const pieces =
    normalized === ""
      ? [{ text: "", startLine: 1, endLine: 1 }]
      : chunkByLines(normalized, OVERLAY_CHUNK_LINES);
  return pieces.map((piece, i) => ({
    id: String(i),
    startLine: piece.startLine,
    endLine: piece.endLine,
    bytes: Buffer.byteLength(piece.text, "utf8"),
    text: piece.text,
  }));
}
