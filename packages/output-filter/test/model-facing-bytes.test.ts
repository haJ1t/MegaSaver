import { describe, expect, it } from "vitest";
import {
  mcpEnvelopeBytes,
  modelFacingBytes,
  overlayModelFacingText,
} from "../src/model-facing-bytes.js";

const excerpt = (text: string, startLine: number, endLine: number) => ({
  text,
  startLine,
  endLine,
});

describe("overlayModelFacingText", () => {
  it("is the summary alone when there are no excerpts and no tail", () => {
    expect(overlayModelFacingText({ summary: "s", excerpts: [] })).toBe("s");
  });

  it("renders excerpts in source order with gap markers between them", () => {
    const text = overlayModelFacingText({
      summary: "sum",
      excerpts: [excerpt("B", 5, 6), excerpt("A", 1, 2)],
      chunkedLineCount: 8,
    });
    expect(text).toBe(
      ["sum", "A", "… [lines 3-4 omitted]", "B", "… [lines 7-8 omitted]"].join("\n"),
    );
  });

  it("opens with a leading marker when the first excerpt does not start at line 1", () => {
    const text = overlayModelFacingText({
      summary: "sum",
      excerpts: [excerpt("X", 3, 4)],
      chunkedLineCount: 4,
    });
    expect(text).toBe(["sum", "… [lines 1-2 omitted]", "X"].join("\n"));
  });

  it("omits the trailing marker when excerpts reach the last chunked line", () => {
    const text = overlayModelFacingText({
      summary: "sum",
      excerpts: [excerpt("X", 1, 4)],
      chunkedLineCount: 4,
    });
    expect(text).toBe(["sum", "X"].join("\n"));
  });

  it("falls back to the max excerpt endLine when chunkedLineCount is absent", () => {
    const text = overlayModelFacingText({
      summary: "sum",
      excerpts: [excerpt("X", 1, 4)],
    });
    expect(text).toBe(["sum", "X"].join("\n"));
  });

  it("appends the footer when provided", () => {
    const text = overlayModelFacingText(
      { summary: "sum", excerpts: [excerpt("X", 1, 1)], chunkedLineCount: 1 },
      "[Mega Saver: footer]",
    );
    expect(text).toBe("sum\nX\n[Mega Saver: footer]");
  });
});

describe("modelFacingBytes", () => {
  it("counts summary + excerpts + gap markers + separators — more than summary+excerpts alone", () => {
    const input = {
      summary: "sum",
      excerpts: [excerpt("AAAA", 10, 20)],
      chunkedLineCount: 30,
    };
    const breakdown = modelFacingBytes(input);
    const naive = Buffer.byteLength("sum", "utf8") + Buffer.byteLength("AAAA", "utf8");
    expect(breakdown.totalBytes).toBeGreaterThan(naive);
    expect(breakdown.gapMarkerBytes).toBeGreaterThan(0);
    expect(breakdown.totalBytes).toBe(Buffer.byteLength(overlayModelFacingText(input), "utf8"));
  });

  it("breakdown components sum to the total", () => {
    const breakdown = modelFacingBytes(
      {
        summary: "sum",
        excerpts: [excerpt("A", 1, 2), excerpt("B", 5, 6)],
        chunkedLineCount: 9,
      },
      "[Mega Saver: footer]",
    );
    expect(
      breakdown.summaryBytes +
        breakdown.excerptBytes +
        breakdown.gapMarkerBytes +
        breakdown.footerBytes +
        breakdown.separatorBytes,
    ).toBe(breakdown.totalBytes);
    expect(breakdown.footerBytes).toBe(Buffer.byteLength("[Mega Saver: footer]", "utf8"));
  });

  it("counts UTF-8 in bytes, not JS string length", () => {
    const breakdown = modelFacingBytes({
      summary: "öz",
      excerpts: [],
    });
    expect(breakdown.totalBytes).toBe(Buffer.byteLength("öz", "utf8"));
    expect(breakdown.totalBytes).toBeGreaterThan("öz".length);
  });
});

describe("mcpEnvelopeBytes", () => {
  it("equals the byte length of the JSON the MCP server delivers", () => {
    const payload = {
      summary: "sum",
      excerpts: [
        {
          text: "A".repeat(100),
          startLine: 1,
          endLine: 3,
          score: 12.5,
          features: { errorScore: 4, keywordScore: 0 },
        },
      ],
      decision: "compressed",
      rawBytes: 10000,
      returnedBytes: 200,
      bytesSaved: 9800,
      savingRatio: 0.98,
    };
    expect(mcpEnvelopeBytes(payload)).toBe(Buffer.byteLength(JSON.stringify(payload), "utf8"));
  });

  it("the envelope exceeds summary+excerpt text bytes (score/features reach the model)", () => {
    const payload = {
      summary: "sum",
      excerpts: [
        {
          text: "short",
          startLine: 1,
          endLine: 1,
          score: 12.5,
          features: { errorScore: 4, keywordScore: 0, pathScore: 1 },
        },
      ],
      rawBytes: 10000,
      returnedBytes: 8,
      bytesSaved: 9992,
      savingRatio: 0.9992,
      chunkSetId: "abc123",
    };
    const textOnly =
      Buffer.byteLength(payload.summary, "utf8") +
      Buffer.byteLength(payload.excerpts[0].text, "utf8");
    expect(mcpEnvelopeBytes(payload)).toBeGreaterThan(textOnly);
  });
});
