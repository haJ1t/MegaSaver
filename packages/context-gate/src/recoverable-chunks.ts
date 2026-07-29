import type { ChunkSet } from "@megasaver/content-store";
import { chunkByLines } from "@megasaver/output-filter";
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
  // An empty output still gets one chunk: the recovery footer advertises
  // `i = 0..N-1`, and N = 0 would advertise a range that cannot be fetched.
  const pieces =
    redacted === ""
      ? [{ text: "", startLine: 1, endLine: 1 }]
      : chunkByLines(redacted, OVERLAY_CHUNK_LINES);
  return pieces.map((piece, i) => ({
    id: String(i),
    startLine: piece.startLine,
    endLine: piece.endLine,
    bytes: Buffer.byteLength(piece.text, "utf8"),
    text: piece.text,
  }));
}
