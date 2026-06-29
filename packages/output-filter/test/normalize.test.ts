import { describe, expect, it } from "vitest";
import { collapseRepeatedLines, collapseSimilar, normalize } from "../src/normalize.js";

describe("normalize (spec §6 stage 2)", () => {
  it("strips ANSI SGR color escape sequences", () => {
    expect(normalize("[31merror[0m")).toBe("error");
  });

  it("collapses CRLF to LF", () => {
    expect(normalize("a\r\nb")).toBe("a\nb");
  });

  it("collapses lone CR to LF", () => {
    expect(normalize("a\rb")).toBe("a\nb");
  });

  it("trims trailing whitespace per line", () => {
    expect(normalize("a   \nb\t")).toBe("a\nb");
  });

  it("leaves clean text unchanged", () => {
    expect(normalize("hello\nworld")).toBe("hello\nworld");
  });
});

describe("collapseRepeatedLines (spec §6 stage 3)", () => {
  it("collapses N>=2 consecutive identical lines into one + marker", () => {
    expect(collapseRepeatedLines("x\nx\nx")).toBe("x\n… [repeated 3 times]");
  });

  it("does not collapse a single occurrence", () => {
    expect(collapseRepeatedLines("x\ny")).toBe("x\ny");
  });

  it("collapses two identical lines", () => {
    expect(collapseRepeatedLines("x\nx")).toBe("x\n… [repeated 2 times]");
  });

  it("only collapses consecutive duplicates", () => {
    expect(collapseRepeatedLines("x\ny\nx")).toBe("x\ny\nx");
  });
});

describe("collapseSimilar (template-line folding)", () => {
  it("folds timestamp-only-varying lines to one exemplar keeping first AND last", () => {
    const input = [
      "2026-06-29T10:00:01Z GET /health 200",
      "2026-06-29T10:00:02Z GET /health 200",
      "2026-06-29T10:00:03Z GET /health 200",
      "2026-06-29T10:00:04Z GET /health 200",
    ].join("\n");
    const out = collapseSimilar(input);
    const lines = out.split("\n");
    expect(lines[0]).toBe("2026-06-29T10:00:01Z GET /health 200");
    expect(lines).toContain("2026-06-29T10:00:04Z GET /health 200");
    expect(out).toMatch(/\[4 similar:/);
    expect(lines.length).toBe(3);
  });

  it("does NOT fold two distinct error lines (evidence guard)", () => {
    const input = [
      "2026-06-29T10:00:01Z ERROR connection refused on port 5432",
      "2026-06-29T10:00:02Z ERROR connection refused on port 5433",
    ].join("\n");
    expect(collapseSimilar(input)).toBe(input);
  });

  it("does not fold lines differing in meaningful content", () => {
    const input = [
      "worker started handling queue alpha",
      "worker started handling queue beta",
    ].join("\n");
    expect(collapseSimilar(input)).toBe(input);
  });

  it("leaves a single line untouched", () => {
    expect(collapseSimilar("2026-06-29T10:00:01Z GET /health 200")).toBe(
      "2026-06-29T10:00:01Z GET /health 200",
    );
  });

  it("is a no-op on already-unique text", () => {
    const input = "alpha\nbeta\ngamma";
    expect(collapseSimilar(input)).toBe(input);
  });

  it("does NOT fold lines differing only by HTTP status code (evidence)", () => {
    const input = [
      "2026-06-29T10:00:01Z GET /health 200",
      "2026-06-29T10:00:02Z GET /health 500",
      "2026-06-29T10:00:03Z GET /health 200",
    ].join("\n");
    expect(collapseSimilar(input)).toBe(input);
  });

  it("does NOT hide a slow request differing only by duration (evidence)", () => {
    const input = ["request done in 5ms", "request done in 9000ms", "request done in 5ms"].join(
      "\n",
    );
    expect(collapseSimilar(input)).toBe(input);
  });

  it("does NOT hide a write differing only by byte count (evidence)", () => {
    const input = ["flush wrote 0 B", "flush wrote 4096 B", "flush wrote 0 B"].join("\n");
    expect(collapseSimilar(input)).toBe(input);
  });

  it("does NOT merge distinct decimal ids (evidence)", () => {
    const input = ["account 100000000001", "account 100000000002", "account 100000000003"].join(
      "\n",
    );
    expect(collapseSimilar(input)).toBe(input);
  });

  // Evidence-preservation: PORT mask folded distinct bind ports — non-recoverable loss
  it("does NOT fold lines differing only by port number (evidence)", () => {
    const input = [
      "listening on port 8080",
      "listening on port 8081",
      "listening on port 9090",
    ].join("\n");
    const out = collapseSimilar(input);
    expect(out).toContain("8080");
    expect(out).toContain("8081");
    expect(out).toContain("9090");
    expect(out).not.toMatch(/\[3 similar:/);
  });

  // Evidence-preservation: bare-HEX mask folded distinct content hashes — non-recoverable loss
  it("does NOT fold lines differing only by content hash (evidence)", () => {
    const input = [
      "blob hash 0123456789abcdef0123456789ab",
      "blob hash fedcba9876543210fedcba987654",
      "blob hash aaaa1111bbbb2222cccc3333dddd",
    ].join("\n");
    const out = collapseSimilar(input);
    expect(out).toContain("fedcba9876543210fedcba987654");
    expect(out).not.toMatch(/\[3 similar:/);
  });

  it("does NOT fold lines differing only by fault address (evidence)", () => {
    const input = [
      "accessing deadbeefdeadbeef",
      "accessing cafebabecafebabe",
      "accessing feedfacefeedface",
    ].join("\n");
    const out = collapseSimilar(input);
    expect(out).toContain("cafebabecafebabe");
    expect(out).not.toMatch(/\[3 similar:/);
  });

  // Bench finding: heartbeat lines whose only variation is a wall-clock
  // timestamp (with a trailing word boundary) were treated as positional
  // evidence by the old POSITION guard and never folded.
  it("folds heartbeat lines varying only by wall-clock timestamp", () => {
    const input = [
      "10:00:01 heartbeat ok",
      "10:00:02 heartbeat ok",
      "10:00:03 heartbeat ok",
      "10:00:04 heartbeat ok",
    ].join("\n");
    const out = collapseSimilar(input);
    const lines = out.split("\n");
    expect(lines[0]).toBe("10:00:01 heartbeat ok");
    expect(lines).toContain("10:00:04 heartbeat ok");
    expect(out).toMatch(/\[4 similar:/);
    expect(lines.length).toBe(3);
  });

  it("folds date+clock heartbeat lines varying only by timestamp", () => {
    const input = [
      "2026-06-29 10:00:01 heartbeat ok",
      "2026-06-29 10:00:02 heartbeat ok",
      "2026-06-29 10:00:03 heartbeat ok",
    ].join("\n");
    const out = collapseSimilar(input);
    expect(out).toMatch(/\[3 similar:/);
  });

  it("does NOT fold two distinct file:line:col position lines (evidence)", () => {
    const input = ["error at app.ts:10:5", "error at app.ts:20:8"].join("\n");
    expect(collapseSimilar(input)).toBe(input);
  });

  it("does NOT fold three distinct file:line:col position lines (evidence)", () => {
    const input = [
      "trace src/main.ts:10:5 enter",
      "trace src/main.ts:20:8 enter",
      "trace src/main.ts:30:1 enter",
    ].join("\n");
    const out = collapseSimilar(input);
    expect(out).toContain("src/main.ts:10:5");
    expect(out).toContain("src/main.ts:20:8");
    expect(out).toContain("src/main.ts:30:1");
    expect(out).not.toMatch(/similar:/);
  });
});
