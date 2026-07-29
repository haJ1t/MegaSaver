// B2 — model-facing byte accounting.
//
// filterOutput's own returnedBytes counts summary + excerpt TEXT only. The
// model actually receives more: the `… [lines X-Y omitted]` gap markers, the
// recovery footer, and — on the MCP transport — the entire JSON envelope
// (per-excerpt `score` and the 9-field `features` object included,
// mcp-bridge/src/server.ts `JSON.stringify(payload)`). This module counts what
// the model receives.
//
// It deliberately does NOT render. An earlier version carried its own copy of
// the overlay renderer and invited record-output.ts to delegate to it; that
// copy numbered gap markers in post-collapse space, which A3 replaced with raw
// coordinates precisely because post-collapse numbering cannot address the
// stored chunks. Delegating would have reverted A3, and keeping two renderers
// in sync is the drift that made the two coordinate systems possible in the
// first place. There is one renderer, in record-output.ts; this counts what it
// produced.

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

// Every gap marker the renderer can emit: the addressable form carrying raw
// line numbers, and the countless form used where a compressor synthesised
// lines and no line number would be truthful.
const GAP_MARKER = /… \[lines \d+-\d+ omitted\]|… \[remainder omitted[^\]]*\]/g;

// Bytes the model receives on the overlay/hook path, measured on the text that
// was ACTUALLY delivered rather than on a re-render of its inputs.
export function modelFacingBytes(input: {
  delivered: string;
  summary: string;
  excerpts: ReadonlyArray<{ text: string }>;
  footer?: string | undefined;
}): ModelFacingBreakdown {
  const summaryBytes = bytesOf(input.summary);
  const excerptBytes = input.excerpts.reduce((sum, e) => sum + bytesOf(e.text), 0);
  const footerBytes = input.footer === undefined ? 0 : bytesOf(input.footer);
  const gapMarkerBytes = (input.delivered.match(GAP_MARKER) ?? []).reduce(
    (sum, m) => sum + bytesOf(m),
    0,
  );
  const totalBytes = bytesOf(input.delivered);
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
