import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { titleSchema } from "../src/title.js";

const CONTROL_CHARS_MESSAGE = "name must not contain control characters";

describe("titleSchema", () => {
  it("accepts a single-character title", () => {
    expect(titleSchema.parse("a")).toBe("a");
  });

  it("accepts a multi-word title with internal spaces", () => {
    expect(titleSchema.parse("first session note")).toBe("first session note");
  });

  it("trims leading and trailing whitespace before validating", () => {
    expect(titleSchema.parse("   padded   ")).toBe("padded");
  });

  it("normalizes decomposed Unicode to NFC", () => {
    // "e" + COMBINING ACUTE ACCENT (U+0301) → "é" (U+00E9)
    const decomposed = "é";
    expect(decomposed.length).toBe(2);
    const parsed = titleSchema.parse(decomposed);
    expect(parsed).toBe("é");
    expect(parsed.length).toBe(1);
  });

  it("rejects the empty string", () => {
    const result = titleSchema.safeParse("");
    expect(result.success).toBe(false);
  });

  it("rejects a whitespace-only string (trims to empty)", () => {
    const result = titleSchema.safeParse("   ");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe("too_small");
    }
  });

  it("rejects a title containing a newline (C0 control)", () => {
    const result = titleSchema.safeParse("first\nsession");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(CONTROL_CHARS_MESSAGE);
    }
  });

  it("rejects a title containing a tab (C0 control)", () => {
    const result = titleSchema.safeParse("col1\tcol2");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(CONTROL_CHARS_MESSAGE);
    }
  });

  it("rejects a title containing DEL (U+007F)", () => {
    const result = titleSchema.safeParse("oops\x7fhere");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(CONTROL_CHARS_MESSAGE);
    }
  });

  it("rejects a title containing a C1 control character", () => {
    const result = titleSchema.safeParse("c1\x85break");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(CONTROL_CHARS_MESSAGE);
    }
  });

  it("rejects a title containing U+2028 LINE SEPARATOR", () => {
    const result = titleSchema.safeParse("line break");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(CONTROL_CHARS_MESSAGE);
    }
  });

  it("rejects a title containing U+2029 PARAGRAPH SEPARATOR", () => {
    const result = titleSchema.safeParse("para break");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(CONTROL_CHARS_MESSAGE);
    }
  });

  it("pins the control-char error message (CLI error-mapper contract)", () => {
    // CLI's mapErrorToCliMessage discriminates the regex-failure case by
    // string-equality on this exact message. Do not change without also
    // changing NAME_CONTROL_CHARS_MESSAGE in apps/cli/src/errors.ts.
    expect(CONTROL_CHARS_MESSAGE).toBe("name must not contain control characters");
  });

  it("property: any printable-ASCII title (codepoints 33–126) is accepted", () => {
    fc.assert(
      fc.property(
        fc
          .stringOf(
            fc.integer({ min: 33, max: 126 }).map((c) => String.fromCharCode(c)),
            { minLength: 1, maxLength: 64 },
          )
          .filter((s) => s.trim().length > 0),
        (s) => {
          expect(titleSchema.parse(s)).toBe(s);
        },
      ),
    );
  });

  it("property: any string containing a C0 control character is rejected", () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.stringOf(
            fc.integer({ min: 33, max: 126 }).map((c) => String.fromCharCode(c)),
            { minLength: 0, maxLength: 8 },
          ),
          fc.integer({ min: 0, max: 31 }).map((c) => String.fromCharCode(c)),
          fc.stringOf(
            fc.integer({ min: 33, max: 126 }).map((c) => String.fromCharCode(c)),
            { minLength: 0, maxLength: 8 },
          ),
        ),
        ([pre, ctrl, post]) => {
          const input = `${pre}${ctrl}${post}`;
          // Skip the degenerate case where trim() eats everything and the
          // schema fails on min(1) first instead of the regex.
          fc.pre(input.trim().length > 0);
          // Skip the case where the control char gets trimmed (leading/trailing whitespace).
          fc.pre(input.trim().includes(ctrl));
          const result = titleSchema.safeParse(input);
          expect(result.success).toBe(false);
        },
      ),
    );
  });
});
