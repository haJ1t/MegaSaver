import { describe, expect, it } from "vitest";
import { mcpEnvelopeBytes, modelFacingBytes } from "../src/model-facing-bytes.js";

// The module counts the text that was delivered; it does not render one. The
// renderer lives in context-gate/record-output.ts and numbers gap markers in
// raw line space (A3). A second renderer here would have to be kept in sync
// with it, and that drift is exactly how the two coordinate systems arose.

const bytes = (s: string): number => Buffer.byteLength(s, "utf8");

describe("modelFacingBytes", () => {
  it("counts the delivered text, not a re-render of its inputs", () => {
    const summary = "2 kept, 4 dropped";
    const excerpts = [{ text: "alpha line" }, { text: "beta line" }];
    const footer = "\n\n[Mega Saver: compressed 100→40 B.]";
    const delivered = `${summary}\n${excerpts[0]?.text}\n… [lines 5-90 omitted]\n${excerpts[1]?.text}${footer}`;

    const b = modelFacingBytes({ delivered, summary, excerpts, footer });

    expect(b.totalBytes).toBe(bytes(delivered));
    expect(b.summaryBytes).toBe(bytes(summary));
    expect(b.excerptBytes).toBe(bytes("alpha line") + bytes("beta line"));
    expect(b.gapMarkerBytes).toBe(bytes("… [lines 5-90 omitted]"));
    expect(b.footerBytes).toBe(bytes(footer));
    expect(b.separatorBytes).toBe(
      b.totalBytes - b.summaryBytes - b.excerptBytes - b.gapMarkerBytes - b.footerBytes,
    );
  });

  it("counts the countless marker the compressor path emits", () => {
    const summary = "s";
    const marker = "… [remainder omitted — recover any part with the chunk ids below]";
    const delivered = `${summary}\nbody${marker}`;
    const b = modelFacingBytes({ delivered, summary, excerpts: [{ text: "body" }] });
    expect(b.gapMarkerBytes).toBe(bytes(marker));
  });

  it("reports zero footer bytes when none was appended", () => {
    const b = modelFacingBytes({
      delivered: "s\nbody",
      summary: "s",
      excerpts: [{ text: "body" }],
    });
    expect(b.footerBytes).toBe(0);
  });
});

describe("mcpEnvelopeBytes", () => {
  it("counts every field the MCP transport serialises, not just excerpt text", () => {
    const payload = { excerpts: [{ text: "x", score: 12.5, features: { errorScore: 4 } }] };
    expect(mcpEnvelopeBytes(payload)).toBe(bytes(JSON.stringify(payload)));
    expect(mcpEnvelopeBytes(payload)).toBeGreaterThan(bytes("x"));
  });
});
