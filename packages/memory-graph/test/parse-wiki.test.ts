import { describe, expect, it } from "vitest";
import { parseWikiPage } from "../src/parse-wiki.js";

const PAGE = `---
title: '@megasaver/core'
tags: [entity, package]
sources:
  - docs/a.md
  - docs/b.md
status: active
---

See [[decisions/bootstrap-matrix]] and [[concepts/foo|Foo]] and [[bar#sec]].
Claim one (source: packages/core/src/x.ts:12). Claim two (source: AA1 §2a). Repeat (source: packages/core/src/x.ts).
`;

describe("parseWikiPage", () => {
  it("extracts frontmatter, links, and path-shaped file citations", () => {
    const w = parseWikiPage("entities/core.md", PAGE);
    expect(w.path).toBe("entities/core.md");
    expect(w.title).toBe("@megasaver/core");
    expect(w.tags).toEqual(["entity", "package"]);
    expect(w.status).toBe("active");
    expect(w.sources).toEqual(["docs/a.md", "docs/b.md"]);
    expect(w.links).toEqual(["decisions/bootstrap-matrix", "concepts/foo", "bar"]); // alias + anchor stripped
    expect(w.fileCites).toEqual(["packages/core/src/x.ts"]); // deduped; prose "AA1 §2a" dropped
  });
  it("defaults title to basename and status to active when frontmatter is absent", () => {
    const w = parseWikiPage("concepts/x.md", "no frontmatter, just [[a]] text");
    expect(w.title).toBe("x");
    expect(w.status).toBe("active");
    expect(w.tags).toEqual([]);
    expect(w.links).toEqual(["a"]);
  });

  // Defect 1: backtick-wrapped citation
  it("strips backtick wrapping from file citations", () => {
    const w = parseWikiPage(
      "syntheses/s.md",
      "See (source: `docs/conventions/risk-modes.md`) for context.",
    );
    expect(w.fileCites).toEqual(["docs/conventions/risk-modes.md"]);
  });

  // Defect 1: wikilink citation rejected
  it("rejects [[wikilink]]-shaped citations from fileCites", () => {
    const w = parseWikiPage(
      "syntheses/s.md",
      "See (source: [[syntheses/contextops-roadmap]]) for context.",
    );
    expect(w.fileCites).toEqual([]);
  });

  // Defect 1: en-dash line range stripped
  it("strips en-dash line range from file citations", () => {
    const w = parseWikiPage(
      "syntheses/s.md",
      "See (source: scripts/manifest.ts:25–72) for context.",
    );
    expect(w.fileCites).toEqual(["scripts/manifest.ts"]);
  });

  // Defect 1: ASCII hyphen line range stripped
  it("strips ASCII-hyphen line range from file citations", () => {
    const w = parseWikiPage(
      "syntheses/s.md",
      "See (source: scripts/manifest.ts:25-72) for context.",
    );
    expect(w.fileCites).toEqual(["scripts/manifest.ts"]);
  });

  // Defect 1 / Defect 4: leading ./ stripped
  it("strips leading ./ from file citations", () => {
    const w = parseWikiPage("syntheses/s.md", "See (source: ./docs/x.md) for context.");
    expect(w.fileCites).toEqual(["docs/x.md"]);
  });

  // Defect 2: CRLF frontmatter
  it("parses CRLF frontmatter correctly without trailing \\r in values", () => {
    const crlfPage = [
      "---\r",
      "title: CRLF Page\r",
      "tags: [crlf, test]\r",
      "status: draft\r",
      "---\r",
      "\r",
      "Body text with (source: src/index.ts).\r",
    ].join("\n");
    const w = parseWikiPage("concepts/crlf.md", crlfPage);
    expect(w.title).toBe("CRLF Page");
    expect(w.tags).toEqual(["crlf", "test"]);
    expect(w.status).toBe("draft");
    expect(w.fileCites).toEqual(["src/index.ts"]);
  });
});
