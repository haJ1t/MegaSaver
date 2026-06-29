# Prose Compressor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic extractive compressor for prose/markdown/docs output to packages/output-filter.

**Architecture:** New `compressProse` function in `compress/prose.ts` → wired into `compressByCategory` → new `"prose"` value in `OutputCategory` + `classifyOutput` sniff added after all existing checks.

**Tech Stack:** TypeScript strict ESM, Vitest, Biome, pnpm workspace.

---

### Task 1: Write failing tests for `compressProse`

**Files:**
- Create: `packages/output-filter/test/compress-prose.test.ts`

- [ ] **Step 1: Create the test file with failing tests**

```typescript
// packages/output-filter/test/compress-prose.test.ts
import { describe, expect, it } from "vitest";
import { compressProse } from "../src/compress/prose.js";

// ─── fixtures ────────────────────────────────────────────────────────────────

const SHORT_DOC = `# Hello

This is a short doc with just one paragraph and a heading. It should pass through unchanged because it is small.`;

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
      // The code fences must appear as real lines, not counted
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
    it("passes short docs through approximately unchanged (≤5 paras, small)", () => {
      const out = compressProse(SHORT_DOC);
      // Should contain the content — may have minor whitespace normalization
      expect(out).toContain("# Hello");
      expect(out).toContain("This is a short doc");
      // Should not add any collapse markers
      expect(out).not.toMatch(/… \[/);
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm RED**

```bash
cd /Users/halitozger/Desktop/MegaSaver
pnpm --filter @megasaver/output-filter test -- --reporter=verbose compress-prose 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '../src/compress/prose.js'`

---

### Task 2: Write failing classify tests for prose

**Files:**
- Modify: `packages/output-filter/test/classify.test.ts`

- [ ] **Step 1: Append prose classify tests to classify.test.ts**

Open `packages/output-filter/test/classify.test.ts` and append before the final closing:

```typescript
// ─── prose category ──────────────────────────────────────────────────────────

const MARKDOWN_DOC = [
  "# Getting Started",
  "",
  "Install the package using npm:",
  "",
  "```bash",
  "npm install",
  "```",
  "",
  "Then run the dev server.",
  "",
  "# Configuration",
  "",
  "Create a config file at `config.json`.",
  "",
  "Add your settings there.",
].join("\n");

const FETCH_SOURCE_PROSE = MARKDOWN_DOC; // simulating web-fetched docs

describe("classifyOutput — prose category", () => {
  it("classifies markdown with headings + code blocks as prose", () => {
    const c = classifyOutput({ text: MARKDOWN_DOC });
    expect(c.category).toBe("prose");
    expect(isConfidentClassification(c)).toBe(true);
  });

  it("classifies markdown with only headings as prose (lower confidence)", () => {
    const headingsOnly = "# Intro\n\nSome text.\n\n# Usage\n\nMore text.";
    const c = classifyOutput({ text: headingsOnly });
    expect(c.category).toBe("prose");
  });

  it("classifies a fetch-source markdown doc as prose", () => {
    const c = classifyOutput({ source: "fetch", text: FETCH_SOURCE_PROSE });
    expect(c.category).toBe("prose");
  });

  it("classifies cat *.md command as prose", () => {
    const c = classifyOutput({ command: "cat README.md", text: MARKDOWN_DOC });
    expect(c.category).toBe("prose");
    expect(c.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("does NOT misclassify a git diff as prose", () => {
    const c = classifyOutput({ text: "diff --git a/foo b/foo\n@@ -1 +1 @@\n-old\n+new" });
    expect(c.category).not.toBe("prose");
  });

  it("does NOT misclassify tsc output as prose", () => {
    const c = classifyOutput({ text: "src/foo.ts(1,1): error TS2304: Cannot find name 'x'." });
    expect(c.category).not.toBe("prose");
  });

  it("does NOT misclassify vitest output as prose", () => {
    const c = classifyOutput({ text: " Test Files  1 failed | 1 passed (2)\n      Tests  1 failed | 4 passed (5)" });
    expect(c.category).not.toBe("prose");
  });

  it("does NOT misclassify plain shell log as prose", () => {
    const shellLog = [".", "..", "file1.ts", "file2.ts", "node_modules"].join("\n");
    const c = classifyOutput({ command: "ls", text: shellLog });
    expect(c.category).not.toBe("prose");
  });

  it("does NOT misclassify large JSON array as prose", () => {
    const arr = JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ id: i, name: `n${i}` })));
    const c = classifyOutput({ text: arr });
    expect(c.category).not.toBe("prose");
  });
});

describe("compressByCategory — prose dispatch", () => {
  it("routes prose to the prose compressor", () => {
    const r = compressByCategory("prose", MARKDOWN_DOC);
    expect(r.compressor).toBe("prose");
  });

  it("prose compressor reduces a long markdown doc", () => {
    const r = compressByCategory("prose", LONG_MARKDOWN);
    expect(r.text.length).toBeLessThan(LONG_MARKDOWN.length);
  });
});

const LONG_MARKDOWN = [
  "# Section One",
  "",
  "First paragraph of section one. This introduces the concept.",
  "",
  "Second paragraph with more details.",
  "",
  "Third paragraph, also not kept.",
  "",
  "# Section Two",
  "",
  "First paragraph of section two.",
  "",
  "```typescript",
  "const x = 1;",
  "```",
  "",
  "More details after the code block.",
].join("\n");
```

- [ ] **Step 2: Run to confirm RED (prose tests fail, others still pass)**

```bash
cd /Users/halitozger/Desktop/MegaSaver
pnpm --filter @megasaver/output-filter test -- --reporter=verbose classify 2>&1 | grep -E "(PASS|FAIL|prose)" | head -20
```

Expected: existing classify tests PASS, new prose tests FAIL.

---

### Task 3: Implement `compressProse`

**Files:**
- Create: `packages/output-filter/src/compress/prose.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// packages/output-filter/src/compress/prose.ts
//
// Extractive prose/markdown compressor. Deterministic, no model.
// Only changes what is RETURNED — raw text persists in ChunkSet as-is.

const ATX_HEADING = /^#{1,6} /;
const FENCE_OPEN = /^```/;
const BULLET_ITEM = /^[-*+] /;
const NUMBERED_ITEM = /^\d+\. /;
const BLOCKQUOTE = /^> /;
// Indented code: 4+ spaces, not inside a list continuation
const INDENTED_CODE = /^ {4}/;

const SHORT_DOC_MAX_PARAS = 5;
const SHORT_DOC_MAX_CHARS = 500;
const LIST_KEEP_FIRST = 3;

type BlockKind =
  | { type: "heading"; line: string }
  | { type: "fence"; lines: string[] }
  | { type: "paragraph"; lines: string[] }
  | { type: "list"; items: string[] }
  | { type: "blockquote"; lines: string[] }
  | { type: "blank" };

function parseBlocks(text: string): BlockKind[] {
  const lines = text.split("\n");
  const blocks: BlockKind[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] as string;

    // Blank line
    if (line.trim() === "") {
      blocks.push({ type: "blank" });
      i++;
      continue;
    }

    // ATX heading
    if (ATX_HEADING.test(line)) {
      blocks.push({ type: "heading", line });
      i++;
      continue;
    }

    // Fenced code block
    if (FENCE_OPEN.test(line)) {
      const fenceLines = [line];
      i++;
      while (i < lines.length) {
        const fl = lines[i] as string;
        fenceLines.push(fl);
        i++;
        if (FENCE_OPEN.test(fl) && fenceLines.length > 1) break;
      }
      blocks.push({ type: "fence", lines: fenceLines });
      continue;
    }

    // Blockquote
    if (BLOCKQUOTE.test(line)) {
      const bqLines = [line];
      i++;
      while (i < lines.length && BLOCKQUOTE.test(lines[i] as string)) {
        bqLines.push(lines[i] as string);
        i++;
      }
      blocks.push({ type: "blockquote", lines: bqLines });
      continue;
    }

    // List (bullet or numbered)
    if (BULLET_ITEM.test(line) || NUMBERED_ITEM.test(line)) {
      const items = [line];
      i++;
      while (i < lines.length) {
        const nl = lines[i] as string;
        if (BULLET_ITEM.test(nl) || NUMBERED_ITEM.test(nl)) {
          items.push(nl);
          i++;
        } else if (nl.startsWith("  ") && nl.trim() !== "") {
          // continuation line — attach to previous item
          items[items.length - 1] += "\n" + nl;
          i++;
        } else {
          break;
        }
      }
      blocks.push({ type: "list", items });
      continue;
    }

    // Indented code block
    if (INDENTED_CODE.test(line)) {
      const codeLines = [line];
      i++;
      while (i < lines.length && (INDENTED_CODE.test(lines[i] as string) || (lines[i] as string).trim() === "")) {
        codeLines.push(lines[i] as string);
        i++;
      }
      // ponytail: treat indented code as a fence block for output purposes
      blocks.push({ type: "fence", lines: codeLines });
      continue;
    }

    // Regular paragraph — accumulate until blank/heading/fence/list
    const paraLines = [line];
    i++;
    while (i < lines.length) {
      const nl = lines[i] as string;
      if (
        nl.trim() === "" ||
        ATX_HEADING.test(nl) ||
        FENCE_OPEN.test(nl) ||
        BULLET_ITEM.test(nl) ||
        NUMBERED_ITEM.test(nl) ||
        BLOCKQUOTE.test(nl)
      ) {
        break;
      }
      paraLines.push(nl);
      i++;
    }
    blocks.push({ type: "paragraph", lines: paraLines });
  }

  return blocks;
}

// Count non-blank, non-heading, non-fence paragraphs
function countParagraphs(blocks: BlockKind[]): number {
  return blocks.filter((b) => b.type === "paragraph").length;
}

export function compressProse(text: string): string {
  const blocks = parseBlocks(text);

  // Short-doc pass-through: ≤5 body paragraphs and ≤500 chars total
  if (text.length <= SHORT_DOC_MAX_CHARS && countParagraphs(blocks) <= SHORT_DOC_MAX_PARAS) {
    return text;
  }

  const out: string[] = [];
  // Track how many body paragraphs we've seen since the last heading
  let parasSeenInSection = 0;
  let pendingParas = 0; // paragraphs elided since last kept one

  const flushPendingParas = () => {
    if (pendingParas > 0) {
      out.push(`… [${pendingParas} paragraph${pendingParas === 1 ? "" : "s"}]`);
      pendingParas = 0;
    }
  };

  for (const block of blocks) {
    switch (block.type) {
      case "heading":
        flushPendingParas();
        parasSeenInSection = 0;
        out.push(block.line);
        break;

      case "fence":
      case "blockquote":
        // Always verbatim — flush any pending count first
        flushPendingParas();
        out.push(...block.lines);
        break;

      case "paragraph": {
        parasSeenInSection++;
        if (parasSeenInSection === 1) {
          // First paragraph of section: keep verbatim
          flushPendingParas();
          out.push(block.lines.join("\n"));
        } else {
          // Subsequent paragraphs: elide
          pendingParas++;
        }
        break;
      }

      case "list": {
        flushPendingParas();
        if (block.items.length <= LIST_KEEP_FIRST) {
          out.push(...block.items);
        } else {
          out.push(...block.items.slice(0, LIST_KEEP_FIRST));
          const tail = block.items.length - LIST_KEEP_FIRST;
          out.push(`… [${tail} more item${tail === 1 ? "" : "s"}]`);
        }
        break;
      }

      case "blank":
        // Preserve blank lines only if not currently accumulating elided paras
        if (pendingParas === 0) out.push("");
        break;
    }
  }

  flushPendingParas();
  return out.join("\n");
}
```

- [ ] **Step 2: Run prose compress tests — expect GREEN**

```bash
cd /Users/halitozger/Desktop/MegaSaver
pnpm --filter @megasaver/output-filter test -- --reporter=verbose compress-prose 2>&1 | tail -30
```

Expected: all compress-prose tests PASS.

---

### Task 4: Add `"prose"` to `OutputCategory` + classify sniff

**Files:**
- Modify: `packages/output-filter/src/classify.ts`

- [ ] **Step 1: Add prose to schema and add prose sniff in `classifyOutput`**

In `classify.ts`:

1. Add `"prose"` to the `outputCategorySchema` enum:
```typescript
export const outputCategorySchema = z.enum([
  "vitest",
  "typescript",
  "diff",
  "structured",
  "prose",        // ← add
  "generic_shell",
  "unknown",
]);
```

2. Add these new constants after the existing regex block:
```typescript
const PROSE_CMD = /\b(?:cat|less|bat)\b.*\.(?:md|rst|txt)\b/i;
// Requires at least one ATX heading. No heading = not confident prose.
const PROSE_HEADING = /^#{1,6} /m;
// Structural markers that raise confidence alongside a heading
const PROSE_STRUCT = /^```|^[-*+] |\b\d+\. /m;
// Guards: if any of these fire on normalized text, prose is disqualified
const PROSE_ANTI_DIFF = /^diff --git |^@@ .* @@/m;
const PROSE_ANTI_TS   = /\(\d+,\d+\):\s+error\s+TS\d+:|error\s+TS\d+:|Found\s+\d+\s+errors?/m;
const PROSE_ANTI_VI   = /^\s*Test Files\s|^\s*Tests\s+\d|AssertionError/m;
```

3. Add `source?: string` to `ClassifyInput`:
```typescript
export type ClassifyInput = {
  command?: string | undefined;
  path?: string | undefined;
  source?: string | undefined;   // ← add: "fetch" for URL-fetched content
  text: string;
};
```

4. In `classifyOutput`, after the `structuredArrayMatch` block and before the
   `generic_shell` fallback, add:

```typescript
  // Prose is checked last among the specialized categories so it never
  // steals diff/typescript/vitest/structured output. Anti-guards ensure
  // we don't misclassify code diagnostics or logs as markdown docs.
  if (
    !PROSE_ANTI_DIFF.test(text) &&
    !PROSE_ANTI_TS.test(text) &&
    !PROSE_ANTI_VI.test(text)
  ) {
    const hasHeading = PROSE_HEADING.test(text);
    const hasStruct = PROSE_STRUCT.test(text);
    const proseCmd = PROSE_CMD.test(command);
    const isFetch = (input.source ?? "") === "fetch";

    if (proseCmd) {
      return { category: "prose", confidence: 0.8 };
    }
    if (isFetch && hasHeading) {
      return { category: "prose", confidence: 0.75 };
    }
    if (hasHeading && hasStruct) {
      return { category: "prose", confidence: 0.85 };
    }
    if (hasHeading) {
      return { category: "prose", confidence: 0.7 };
    }
  }
```

5. Update `isConfidentClassification` to include `"prose"`:
```typescript
export function isConfidentClassification(c: Classification): boolean {
  return (
    (c.category === "vitest" ||
      c.category === "typescript" ||
      c.category === "diff" ||
      c.category === "structured" ||
      c.category === "prose") &&        // ← add
    c.confidence >= CLASSIFICATION_CONFIDENCE_FLOOR
  );
}
```

- [ ] **Step 2: Run classify tests — expect GREEN for existing + new prose tests**

```bash
cd /Users/halitozger/Desktop/MegaSaver
pnpm --filter @megasaver/output-filter test -- --reporter=verbose classify 2>&1 | tail -40
```

---

### Task 5: Wire prose into `compressByCategory`

**Files:**
- Modify: `packages/output-filter/src/compress/index.ts`

- [ ] **Step 1: Import compressProse and add "prose" to CompressorName + dispatch**

```typescript
import type { OutputCategory } from "../classify.js";
import { compressDiff } from "./diff.js";
import { compressJson } from "./json.js";
import { compressProse } from "./prose.js";
import { compressTsc } from "./tsc.js";
import { compressVitest } from "./vitest.js";

export type CompressorName = "vitest" | "typescript" | "diff" | "structured" | "prose" | "generic";

export function compressByCategory(
  category: OutputCategory,
  text: string,
  intent?: string,
): { text: string; compressor: CompressorName } {
  if (category === "vitest") return { text: compressVitest(text), compressor: "vitest" };
  if (category === "typescript") return { text: compressTsc(text), compressor: "typescript" };
  if (category === "diff") return { text: compressDiff(text), compressor: "diff" };
  if (category === "structured")
    return { text: compressJson(text, intent), compressor: "structured" };
  if (category === "prose") return { text: compressProse(text), compressor: "prose" };
  return { text, compressor: "generic" };
}
```

- [ ] **Step 2: Run all output-filter tests — expect GREEN**

```bash
cd /Users/halitozger/Desktop/MegaSaver
pnpm --filter @megasaver/output-filter test 2>&1 | tail -20
```

---

### Task 6: Full verify + typecheck + lint

- [ ] **Step 1: Run typecheck**

```bash
cd /Users/halitozger/Desktop/MegaSaver
pnpm typecheck 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 2: Run biome lint on changed files**

```bash
cd /Users/halitozger/Desktop/MegaSaver
pnpm lint 2>&1 | tail -20
```

Expected: no errors. If biome flags formatting, run `pnpm lint:fix` on the affected files.

- [ ] **Step 3: Full pnpm verify**

```bash
cd /Users/halitozger/Desktop/MegaSaver
pnpm verify 2>&1 | tail -30
```

Expected: lint + typecheck + test all green.

---

### Task 7: Add changeset + commit

**Files:**
- Create: `.changeset/prose-compressor.md`

- [ ] **Step 1: Create changeset**

```markdown
---
"@megasaver/output-filter": minor
---

feat(output-filter): add extractive prose/markdown compressor (WS4)

New `compressProse` function collapses prose/markdown docs
extractively: keeps all headings, first paragraph per section, all
fenced code blocks verbatim, and collapses extra paragraphs/list
tails to counted `… [N paragraphs]` / `… [N more items]` markers.

New `"prose"` OutputCategory with classifier sniff. Checked after
diff/typescript/vitest/structured so it never steals those.
Deterministic, no model, lossless (raw persists to ChunkSet).
```

- [ ] **Step 2: Stage and commit (explicit files only — never `git add .`)**

```bash
cd /Users/halitozger/Desktop/MegaSaver
git add \
  packages/output-filter/src/compress/prose.ts \
  packages/output-filter/src/classify.ts \
  packages/output-filter/src/compress/index.ts \
  packages/output-filter/test/compress-prose.test.ts \
  packages/output-filter/test/classify.test.ts \
  .changeset/prose-compressor.md \
  docs/superpowers/specs/2026-06-30-prose-compressor-design.md \
  docs/superpowers/plans/2026-06-30-prose-compressor.md

git commit -m "feat(output-filter): extractive prose/markdown compressor (WS4)"
```
