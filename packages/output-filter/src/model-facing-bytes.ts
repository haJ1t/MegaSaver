// B2 — model-facing byte accounting.
//
// filterOutput's own returnedBytes counts summary + excerpt TEXT only. The
// model actually receives more: the `… [lines X-Y omitted]` gap markers, the
// recovery footer, and — on the MCP transport — the entire JSON envelope
// (per-excerpt `score` and the 9-field `features` object included,
// mcp-bridge/src/server.ts `JSON.stringify(payload)`). This module is the
// single place that counts what the model receives.
//
// Ownership split: Track B creates and exports this module; Track A wires it
// into `types.ts` / `record-output.ts`. `record-output.ts`'s `returnedTextOf`
// should delegate to `overlayModelFacingText` when that wiring lands — until
// then this renderer mirrors it exactly (D16 source ordering + cursor logic).

export type OverlayRenderInput = {
  summary: string;
  excerpts: ReadonlyArray<{ text: string; startLine: number; endLine: number }>;
  // Total line count of the text the excerpts index into (post-collapse
  // space). Absent → the max excerpt endLine, matching the renderer fallback.
  chunkedLineCount?: number | undefined;
};

// Canonical overlay rendering: summary first, excerpts in SOURCE order, a gap
// marker wherever kept excerpts are not contiguous, a trailing marker up to
// the last chunked line. Spliced fragments can never parse as contiguous code.
export function overlayModelFacingText(input: OverlayRenderInput, footer?: string): string {
  const total =
    input.chunkedLineCount ??
    (input.excerpts.length > 0 ? Math.max(...input.excerpts.map((e) => e.endLine)) : 0);
  const ordered = [...input.excerpts].sort(
    (a, b) => a.startLine - b.startLine || a.endLine - b.endLine,
  );
  const parts: string[] = [input.summary];
  let cursor = 1;
  for (const e of ordered) {
    if (e.startLine > cursor) parts.push(`… [lines ${cursor}-${e.startLine - 1} omitted]`);
    parts.push(e.text);
    cursor = Math.max(cursor, e.endLine + 1);
  }
  if (cursor <= total) parts.push(`… [lines ${cursor}-${total} omitted]`);
  if (footer !== undefined) parts.push(footer);
  return parts.join("\n");
}

export type ModelFacingBreakdown = {
  totalBytes: number;
  summaryBytes: number;
  excerptBytes: number;
  gapMarkerBytes: number;
  footerBytes: number;
  // The "\n" joins between rendered parts — small, but the model pays for them.
  separatorBytes: number;
};

const bytesOf = (text: string): number => Buffer.byteLength(text, "utf8");

// Bytes the model receives on the overlay/hook path: summary + excerpts +
// gap markers + footer, separators included. Pass the SAME footer string the
// caller appends to the delivered text (record-output's recovery footer).
export function modelFacingBytes(input: OverlayRenderInput, footer?: string): ModelFacingBreakdown {
  const rendered = overlayModelFacingText(input, footer);
  const summaryBytes = bytesOf(input.summary);
  const excerptBytes = input.excerpts.reduce((sum, e) => sum + bytesOf(e.text), 0);
  const footerBytes = footer === undefined ? 0 : bytesOf(footer);
  const markerRe = /… \[lines \d+-\d+ omitted\]/g;
  const gapMarkerBytes = (rendered.match(markerRe) ?? []).reduce((sum, m) => sum + bytesOf(m), 0);
  const totalBytes = bytesOf(rendered);
  return {
    totalBytes,
    summaryBytes,
    excerptBytes,
    gapMarkerBytes,
    footerBytes,
    separatorBytes: totalBytes - summaryBytes - excerptBytes - gapMarkerBytes - footerBytes,
  };
}

// Bytes the model receives on the MCP transport: the server delivers
// `JSON.stringify(payload)` as the tool result text, so every field — scores,
// rank features, metrics blocks, chunkSetId, warnings — is model-facing.
export function mcpEnvelopeBytes(payload: unknown): number {
  return bytesOf(JSON.stringify(payload));
}
