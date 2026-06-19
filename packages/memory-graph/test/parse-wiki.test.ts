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
});
