import { describe, expect, it } from "vitest";
import { compressProse } from "../src/compress/prose.js";

// ─── fixtures ────────────────────────────────────────────────────────────────

const SHORT_DOC = `# Hello

This is a short doc with just one paragraph.`;

const LONG_DOC = [
  "# Introduction",
  "",
  "This is the first paragraph of the introduction. It provides context.",
  "",
  "This is the second paragraph. It has more details.",
  "",
  "This is the third paragraph. Still more details.",
  "",
  "This is the fourth paragraph. Even more.",
  "",
  "# Installation",
  "",
  "Run the following command to install:",
  "",
  "```bash",
  "npm install my-package",
  "```",
  "",
  "Then configure your environment.",
  "",
  "More config details here.",
  "",
  "# API Reference",
  "",
  "The API exposes a single function:",
  "",
  "```typescript",
  "function doThing(opts: Options): Result;",
  "```",
  "",
  "Use it like this.",
  "",
  "More usage details.",
].join("\n");

const LIST_DOC = [
  "# Features",
  "",
  "Here are the key features:",
  "",
  "- Feature one is fast",
  "- Feature two is reliable",
  "- Feature three is cheap",
  "- Feature four is new",
  "- Feature five is experimental",
  "",
  "# Short List Section",
  "",
  "Only two items:",
  "",
  "- Alpha",
  "- Beta",
].join("\n");

// ─── tests ────────────────────────────────────────────────────────────────────

describe("compressProse", () => {
  describe("headings always preserved", () => {
    it("keeps all ATX headings in the output", () => {
      const out = compressProse(LONG_DOC);
      expect(out).toContain("# Introduction");
      expect(out).toContain("# Installation");
      expect(out).toContain("# API Reference");
    });
  });

  describe("first paragraph per section preserved", () => {
    it("keeps the first paragraph under each heading", () => {
      const out = compressProse(LONG_DOC);
      expect(out).toContain("This is the first paragraph of the introduction.");
    });

    it("collapses extra paragraphs to counted marker", () => {
      const out = compressProse(LONG_DOC);
      expect(out).toMatch(/… \[\d+ paragraphs?\]/);
    });

    it("does not include middle-section paragraphs verbatim", () => {
      const out = compressProse(LONG_DOC);
      expect(out).not.toContain("This is the third paragraph.");
      expect(out).not.toContain("This is the fourth paragraph.");
    });
  });

  describe("fenced code blocks always verbatim", () => {
    it("keeps fenced code blocks intact", () => {
      const out = compressProse(LONG_DOC);
      expect(out).toContain("```bash");
      expect(out).toContain("npm install my-package");
      expect(out).toContain("```typescript");
      expect(out).toContain("function doThing(opts: Options): Result;");
    });

    it("never collapses a code block inside a counted marker", () => {
      const out = compressProse(LONG_DOC);
      const lines = out.split("\n");
      const fenceLines = lines.filter((l) => l.startsWith("```"));
      expect(fenceLines.length).toBeGreaterThanOrEqual(4); // 2 open + 2 close
    });
  });

  describe("list compression", () => {
    it("collapses list tail beyond 3 items with counted marker", () => {
      const out = compressProse(LIST_DOC);
      expect(out).toContain("- Feature one is fast");
      expect(out).toContain("- Feature two is reliable");
      expect(out).toContain("- Feature three is cheap");
      expect(out).not.toContain("- Feature four is new");
      expect(out).toMatch(/… \[\d+ more items?\]/);
    });

    it("keeps short lists (≤3 items) whole", () => {
      const out = compressProse(LIST_DOC);
      expect(out).toContain("- Alpha");
      expect(out).toContain("- Beta");
    });
  });

  describe("measurable reduction", () => {
    it("reduces a long markdown doc by at least 30%", () => {
      const out = compressProse(LONG_DOC);
      expect(out.length).toBeLessThan(LONG_DOC.length * 0.7);
    });
  });

  describe("short doc pass-through", () => {
    it("passes short docs through unchanged", () => {
      const out = compressProse(SHORT_DOC);
      expect(out).toContain("# Hello");
      expect(out).toContain("This is a short doc");
      expect(out).not.toMatch(/… \[/);
    });
  });
});
