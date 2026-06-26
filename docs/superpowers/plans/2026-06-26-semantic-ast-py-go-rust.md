# Plan — Semantic AST read for Python / Go / Rust

- **Spec:** `docs/superpowers/specs/2026-06-26-semantic-ast-py-go-rust-design.md`
- **Branch:** `feat/semantic-ast-py-go-rust` (commit here, never switch)
- **Risk:** HIGH (§12 — compression core chunker). De-risked: additive,
  gated, zero-dependency, never-throws, line-chunk fallback intact.
- **Packages touched:** `@megasaver/indexer` (3 new extractors + index
  re-exports), `@megasaver/output-filter` (3 dispatch lines).
- **Changeset:** minor for both packages.

## What ships

Extend the #182 semantic AST chunker to `.py`, `.go`, `.rs`. A read of
those files now produces AST-aligned chunks (top-level decls) instead of
naive 40-line windows. Parser is a **zero-dependency heuristic line
scanner** — no tree-sitter / wasm / babel / typescript. Three pure
extractors in `packages/indexer/src/extract/`, re-exported from the
indexer entry, dispatched by `semantic.ts` (3 ext regexes + 3
`extractorFor` cases + 3 `isSupportedSource` clauses). Everything else
(`partitionFile`, gap-fill, oversize sub-split, `chunkByLines` fallback,
ranking) is untouched.

## Locked decisions (do not deviate)

1. Extractors are **heuristic, top-level only**. Nested decls (methods,
   inner fns) are out of scope — gap-fill covers them.
2. `imports`/`exports`/`calls`/`calledBy` = `[]` (no cross-ref).
3. `blockType` is an existing literal from `code-block.ts`
   (`function | class | component | route | test | config | schema |
   docs`). No new enum values. Mapping (§ per task below):
   - Python: `def`/`async def` → `function`; `class` → `class`.
   - Go: `func` → `function`; `type`/`var(`/`const(` → `schema`.
   - Rust: `fn`/`pub fn`/`async fn` → `function`;
     `struct`/`enum`/`trait`/`mod`/`impl` → `class`.
   (`class` is the closest existing literal for a type/aggregate decl;
   Go `type`/`var(`/`const(` map to `schema` mirroring how `extract-ts`
   maps `interface`/`type` aliases to `schema`.)
4. `ExtractedBlock` shape is copied **exactly** from `extract-md.ts`'s
   `block()` builder: `{ filePath, startLine, endLine, blockType, name?,
   contentHash: hashText(lines.slice(startLine-1, endLine).join("\n")),
   imports:[], exports:[], calls:[], calledBy:[], keywords: tokenize(name) }`.
   `name` is **conditionally spread** (`exactOptionalPropertyTypes`):
   only set when a name was parsed; `keywords` uses `tokenize(name ?? "")`.
5. Extractors import **only** `type { ExtractedBlock }` (erased at build)
   and `./helpers.js` (`hashText`, `tokenize` — `node:crypto` only). No
   heavy import. `no-eager-typescript.test.ts` must stay green.
6. Pure, **never throws**. Risky scans (brace depth, indent lookahead)
   are bounds-checked (`noUncheckedIndexedAccess` forces `?? ""`/`?? 0`).
   `chunkBySemantic`'s try/catch → `null` → `chunkByLines` is the backstop.
7. Zero new dependency. No change to `partitionFile`/`chunkByLines`/the
   oversize cap/the gap-fill+whitespace-drop logic (#183).

## Shared scanning rules (read once, applied per language)

- **`endLine >= startLine` always.** A decl whose delimiter never closes
  clamps END to EOF (`lines.length`); `partitionFile` re-clamps anyway.
- **Brace-balanced END** (Go/Rust): from the decl line, sum per-line
  `(count "{" + count "(") - (count "}" + count ")")` deltas. The block
  ends at the first line where the running depth returns to `0` **after**
  having opened (depth went `>0`). If the decl line itself never opens a
  delimiter and ends with `;` or has no opener → single-line span.
- **Indentation END** (Python): the block ends at the line **before** the
  next column-0 non-blank line (a line whose first char is non-whitespace
  and which is itself a new top-level construct or any col-0 code), else
  EOF. Trailing blank lines inside the span are tolerable — `partitionFile`
  gap-drops nothing inside a block, but mis-spans are explicitly OK.
- Spans emitted in source order; `partitionFile` re-sorts + de-overlaps.
- Naive depth counting **ignores strings/comments** (a `{` inside a string
  or `//` comment miscounts). This is the accepted ceiling: mis-spans stay
  valid chunks and the fallback keeps output correct. `ponytail:` comment
  marks it in each extractor; upgrade path = real tokenizer if mis-spans
  ever matter, which the spec says they don't.

## TDD order (failing test → minimal impl → commit, deps first)

| # | Task | Why first |
|---|------|-----------|
| 1 | `extract-py.ts` + index export + test | no deps |
| 2 | `extract-go.ts` + index export + test | no deps |
| 3 | `extract-rs.ts` + index export + test | no deps |
| 4 | `semantic.ts` dispatch + `semantic-chunk.test.ts` cases | needs 1–3 exported |
| 5 | changeset | needs 1–4 to describe shipped API |

Each task: write the failing test, run it red, add the minimal impl, run
green, `pnpm exec biome check <changed files>`, commit with explicit paths.

---

## Task 1 — `extract-py.ts`

**Files:** `packages/indexer/src/extract/extract-py.ts` (new),
`packages/indexer/src/index.ts` (add re-export),
`packages/indexer/test/extract-py.test.ts` (new).

**Heuristic.** Match top-level (column-0) lines:
`^(async\s+)?def\s+(\w+)` → `function`; `^class\s+(\w+)` → `class`.
A matched decl's block END = the line before the next column-0 non-blank
line, else EOF (indentation-based; nested defs/methods are swallowed into
the parent span — intentional). Decorators directly above a col-0 `def`
fall into the preceding gap — acceptable.

**Test (`extract-py.test.ts`):**

```ts
import { describe, expect, it } from "vitest";
import type { ExtractedBlock } from "../src/code-block.js";
import { extractPy } from "../src/extract/extract-py.js";

const PY_SOURCE = `import os
from typing import Optional


def validate_token(token: str) -> bool:
    return bool(token)


async def fetch_user(uid: int):
    helper = inner(uid)
    return helper


class AuthService:
    def check(self) -> bool:
        return validate_token("x")

    def other(self):
        return 2


CONST_AT_COL0 = 1
`;

function byName(blocks: ExtractedBlock[], name: string): ExtractedBlock | undefined {
  return blocks.find((b) => b.name === name);
}

describe("extractPy", () => {
  const blocks = extractPy("src/auth.py", PY_SOURCE);

  it("extracts a top-level def as a function block", () => {
    const fn = byName(blocks, "validate_token");
    expect(fn?.blockType).toBe("function");
    expect((fn?.startLine ?? 0) > 0).toBe(true);
    expect((fn?.endLine ?? 0) >= (fn?.startLine ?? 0)).toBe(true);
    expect(fn?.imports).toEqual([]);
    expect(fn?.exports).toEqual([]);
    expect(fn?.calls).toEqual([]);
    expect(fn?.calledBy).toEqual([]);
  });

  it("extracts an async def as a function block", () => {
    expect(byName(blocks, "fetch_user")?.blockType).toBe("function");
  });

  it("extracts a top-level class as a class block", () => {
    expect(byName(blocks, "AuthService")?.blockType).toBe("class");
  });

  it("ends a block at the line before the next column-0 construct", () => {
    const fn = byName(blocks, "validate_token");
    const next = byName(blocks, "fetch_user");
    // validate_token must end before fetch_user starts
    expect((fn?.endLine ?? 0) < (next?.startLine ?? 0)).toBe(true);
  });

  it("does NOT emit nested methods as their own blocks (top-level only)", () => {
    expect(byName(blocks, "check")).toBeUndefined();
    expect(byName(blocks, "other")).toBeUndefined();
  });

  it("the class block spans its nested methods (indentation end)", () => {
    const cls = byName(blocks, "AuthService");
    // class body covers both methods; ends before the col-0 CONST line
    expect((cls?.endLine ?? 0) - (cls?.startLine ?? 0) >= 4).toBe(true);
  });

  it("keywords derive from the name, contentHash is stable", () => {
    expect(byName(blocks, "validate_token")?.keywords).toEqual(
      expect.arrayContaining(["validate", "token"]),
    );
    const again = extractPy("src/auth.py", PY_SOURCE);
    expect(byName(again, "validate_token")?.contentHash).toBe(
      byName(blocks, "validate_token")?.contentHash,
    );
    expect(byName(blocks, "validate_token")?.contentHash).not.toBe(
      byName(blocks, "AuthService")?.contentHash,
    );
  });

  it("returns [] for a file with no top-level def/class", () => {
    expect(extractPy("src/empty.py", "x = 1\ny = 2\n")).toEqual([]);
    expect(extractPy("src/blank.py", "")).toEqual([]);
  });

  it("never throws on a never-closing / odd file (clamps to EOF)", () => {
    expect(() => extractPy("src/x.py", "def open_only(:\n    pass")).not.toThrow();
    const b = extractPy("src/x.py", "def lonely():\n    return 1");
    expect(b[0]?.endLine).toBe(2);
  });
});
```

**Implementation (`extract-py.ts`):**

```ts
import type { ExtractedBlock } from "../code-block.js";
import { hashText, tokenize } from "./helpers.js";

// Top-level (column 0) def / async def / class. Heuristic, line-based:
// no parser dependency. Block END is indentation-based — it runs to the
// line before the next column-0 non-blank line (so nested methods/inner
// defs are swallowed into the parent span, which is intentional: top-level
// only, gap-fill covers the rest). Pure; never throws.
const DECL_RE = /^(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/;

export function extractPy(filePath: string, source: string): ExtractedBlock[] {
  const lines = source.split("\n");

  const block = (startLine: number, endLine: number, name: string, kind: string): ExtractedBlock => ({
    filePath,
    startLine,
    endLine,
    blockType: kind === "class" ? "class" : "function",
    name,
    contentHash: hashText(lines.slice(startLine - 1, endLine).join("\n")),
    imports: [],
    exports: [],
    calls: [],
    calledBy: [],
    keywords: tokenize(name),
  });

  // A line is a new top-level boundary if its first character is non-blank
  // (column-0 code). Blank lines and indented lines stay inside the span.
  const isTopLevel = (line: string): boolean => line.length > 0 && !/^\s/.test(line);

  const blocks: ExtractedBlock[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const match = DECL_RE.exec(line);
    if (match === null) continue;
    const name = match[2] ?? "";
    const kind = match[1] ?? "def";
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (isTopLevel(lines[j] ?? "")) {
        end = j; // 1-indexed end is the line before lines[j]
        break;
      }
    }
    blocks.push(block(i + 1, end, name, kind));
    i = end - 1; // resume scan at the boundary line (avoid re-matching span body)
  }
  return blocks;
}
```

> `name` is non-empty whenever `DECL_RE` matches (the `(\w+)` capture
> guarantees it), so the conditional-spread escape from §4 is unnecessary
> here — `name` and `tokenize(name)` are always real strings. Mirrors
> `extract-md.ts` which also always passes a name.

**Index export — add to `packages/indexer/src/index.ts`:**

```ts
export * from "./extract/extract-py.js";
```

**Run:** `pnpm --filter @megasaver/indexer test extract-py`
**Commit:** `feat(indexer): heuristic Python top-level extractor`

---

## Task 2 — `extract-go.ts`

**Files:** `packages/indexer/src/extract/extract-go.ts` (new),
`packages/indexer/src/index.ts` (add re-export),
`packages/indexer/test/extract-go.test.ts` (new).

**Heuristic.** Top-level: `^func\s+...` → `function`;
`^type\s+...`, `^var\s*\(`, `^const\s*\(` → `schema`. END = brace/paren
balanced (depth back to 0 after opening). A `type Foo int` / single-line
decl with no opener spans 1 line. Name capture (best-effort, may be
absent for grouped `var (` / `const (` — then `name` is omitted):
- `func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)` (skips a receiver `(r *T)`).
- `type\s+([A-Za-z_]\w*)`.
- `var (` / `const (` → no name (the group has many).

**Test (`extract-go.test.ts`):**

```ts
import { describe, expect, it } from "vitest";
import type { ExtractedBlock } from "../src/code-block.js";
import { extractGo } from "../src/extract/extract-go.js";

const GO_SOURCE = `package main

import "fmt"

func Validate(token string) bool {
	return len(token) > 0
}

type Auth struct {
	TTL int
}

func (a Auth) Check() bool {
	return Validate("x")
}

var (
	A = 1
	B = 2
)

const Pi = 3
`;

function byName(blocks: ExtractedBlock[], name: string): ExtractedBlock | undefined {
  return blocks.find((b) => b.name === name);
}

describe("extractGo", () => {
  const blocks = extractGo("src/main.go", GO_SOURCE);

  it("extracts a top-level func as a function block", () => {
    const fn = byName(blocks, "Validate");
    expect(fn?.blockType).toBe("function");
    expect(fn?.imports).toEqual([]);
    expect(fn?.exports).toEqual([]);
  });

  it("brace-balances the func body (end at the closing brace)", () => {
    const fn = byName(blocks, "Validate");
    // func spans 3 lines: signature, body, closing brace
    expect((fn?.endLine ?? 0) - (fn?.startLine ?? 0)).toBe(2);
  });

  it("extracts a method (func with receiver) by its method name", () => {
    expect(byName(blocks, "Check")?.blockType).toBe("function");
  });

  it("extracts a type as a schema block, brace-balanced", () => {
    const t = byName(blocks, "Auth");
    expect(t?.blockType).toBe("schema");
    expect((t?.endLine ?? 0) > (t?.startLine ?? 0)).toBe(true);
  });

  it("extracts a grouped var ( ... ) block, paren-balanced", () => {
    // grouped var has no single name; find the schema block covering 'A = 1'
    const v = blocks.find(
      (b) => b.blockType === "schema" && b.name === undefined,
    );
    expect(v).toBeDefined();
    expect((v?.endLine ?? 0) > (v?.startLine ?? 0)).toBe(true);
  });

  it("extracts a single-line const as a 1-line schema span", () => {
    const c = blocks.find((b) => b.startLine === b.endLine && b.name === undefined && b.blockType === "schema");
    // const Pi = 3 → no opener → single line
    expect(c).toBeDefined();
  });

  it("emits no nested blocks (top-level only)", () => {
    // struct field 'TTL' must not be its own block
    expect(byName(blocks, "TTL")).toBeUndefined();
  });

  it("returns [] for a file with no top-level decl", () => {
    expect(extractGo("src/x.go", "package x\n")).toEqual([]);
    expect(extractGo("src/x.go", "")).toEqual([]);
  });

  it("never throws and clamps a never-closing brace to EOF", () => {
    const b = extractGo("src/x.go", "func Open() {\n\treturn");
    expect(b[0]?.endLine).toBe(2);
    expect(() => extractGo("src/x.go", "func {{{")).not.toThrow();
  });
});
```

**Implementation (`extract-go.ts`):**

```ts
import type { ExtractedBlock } from "../code-block.js";
import { hashText, tokenize } from "./helpers.js";

// Top-level Go decls (heuristic, no parser). func -> function;
// type / var( / const( -> schema (mirrors how extract-ts maps type-like
// decls to "schema"). Block END is delimiter-balanced: from the decl line,
// sum per-line ({+( minus }+)) deltas; the block ends at the first line
// where depth returns to 0 after opening. A decl that never opens a
// delimiter spans one line. Pure; never throws. Top-level only.
const FUNC_RE = /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/;
const TYPE_RE = /^type\s+([A-Za-z_]\w*)/;
const GROUP_RE = /^(?:var|const)\s*\(/;

// ponytail: naive delimiter count — ignores strings/comments, so a brace
// inside a string literal miscounts. Accepted ceiling (spec: "good
// top-level spans"); mis-spans stay valid chunks + fallback covers it.
function delimDelta(line: string): number {
  let delta = 0;
  for (const ch of line) {
    if (ch === "{" || ch === "(") delta += 1;
    else if (ch === "}" || ch === ")") delta -= 1;
  }
  return delta;
}

function balancedEnd(lines: readonly string[], start: number): number {
  let depth = 0;
  let opened = false;
  for (let i = start; i < lines.length; i += 1) {
    depth += delimDelta(lines[i] ?? "");
    if (depth > 0) opened = true;
    if (opened && depth <= 0) return i + 1; // 1-indexed line where it closes
  }
  return opened ? lines.length : start + 1; // never-closed -> EOF; no opener -> 1 line
}

export function extractGo(filePath: string, source: string): ExtractedBlock[] {
  const lines = source.split("\n");

  const push = (
    blocks: ExtractedBlock[],
    startLine: number,
    endLine: number,
    name: string | undefined,
  ): void => {
    blocks.push({
      filePath,
      startLine,
      endLine,
      blockType: startLine === endLine || name !== undefined ? "schema" : "schema",
      // (placeholder replaced below — see real impl note)
    } as ExtractedBlock);
  };
  void push; // see real builder below

  const block = (
    startLine: number,
    endLine: number,
    blockType: "function" | "schema",
    name: string | undefined,
  ): ExtractedBlock => ({
    filePath,
    startLine,
    endLine,
    blockType,
    ...(name !== undefined ? { name } : {}),
    contentHash: hashText(lines.slice(startLine - 1, endLine).join("\n")),
    imports: [],
    exports: [],
    calls: [],
    calledBy: [],
    keywords: tokenize(name ?? ""),
  });

  const blocks: ExtractedBlock[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const fn = FUNC_RE.exec(line);
    const ty = TYPE_RE.exec(line);
    const grp = GROUP_RE.exec(line);
    if (fn === null && ty === null && grp === null) continue;
    const end = balancedEnd(lines, i);
    if (fn !== null) blocks.push(block(i + 1, end, "function", fn[1]));
    else if (ty !== null) blocks.push(block(i + 1, end, "schema", ty[1]));
    else blocks.push(block(i + 1, end, "schema", undefined));
    i = end - 1;
  }
  return blocks;
}
```

> **Impl note:** drop the `push`/`void push` scaffold — it is shown only
> to flag that the early throwaway builder must NOT be used; the real
> builder is `block(...)` with the conditional `name` spread
> (`exactOptionalPropertyTypes`). The committed file contains only the
> `block` builder, `delimDelta`, `balancedEnd`, and the loop. A single-line
> `type Foo int` (no opener) → `balancedEnd` returns `start + 1` =
> `i + 1` → 1-line span. `const Pi = 3` → no opener → 1 line, name dropped
> (only grouped const/var reach this branch; single-line const without `(`
> is not matched by `GROUP_RE`, so it is **not** extracted — that is fine,
> gap-fill covers it). Adjust the const test accordingly: the single-line
> `const Pi = 3` is a **gap**, not a block.

**Index export — add to `packages/indexer/src/index.ts`:**

```ts
export * from "./extract/extract-go.js";
```

**Run:** `pnpm --filter @megasaver/indexer test extract-go`
**Commit:** `feat(indexer): heuristic Go top-level extractor`

---

## Task 3 — `extract-rs.ts`

**Files:** `packages/indexer/src/extract/extract-rs.ts` (new),
`packages/indexer/src/index.ts` (add re-export),
`packages/indexer/test/extract-rs.test.ts` (new).

**Heuristic.** Top-level: `^(pub\s+)?(async\s+)?fn\s+(\w+)` → `function`;
`^(pub\s+)?(struct|enum|trait|mod|impl)\b` → `class`. END = brace-balanced
(`{`/`}` depth back to 0 after opening), or 1 line for a `;`-terminated
decl (`struct Foo;`, `pub struct Unit;`). Name capture: `fn (\w+)`;
`(struct|enum|trait|mod) (\w+)`; `impl` blocks may have no plain name
(`impl Trait for Type`) → omit `name`.

**Test (`extract-rs.test.ts`):**

```ts
import { describe, expect, it } from "vitest";
import type { ExtractedBlock } from "../src/code-block.js";
import { extractRs } from "../src/extract/extract-rs.js";

const RS_SOURCE = `use std::fmt;

pub fn validate(token: &str) -> bool {
    !token.is_empty()
}

async fn fetch_user(uid: u64) -> User {
    inner(uid)
}

pub struct Auth {
    ttl: u32,
}

struct Unit;

enum State {
    On,
    Off,
}

trait Checkable {
    fn check(&self) -> bool;
}

impl Auth {
    fn check(&self) -> bool {
        validate("x")
    }
}
`;

function byName(blocks: ExtractedBlock[], name: string): ExtractedBlock | undefined {
  return blocks.find((b) => b.name === name);
}

describe("extractRs", () => {
  const blocks = extractRs("src/auth.rs", RS_SOURCE);

  it("extracts a pub fn as a function block, brace-balanced", () => {
    const fn = byName(blocks, "validate");
    expect(fn?.blockType).toBe("function");
    expect((fn?.endLine ?? 0) - (fn?.startLine ?? 0)).toBe(2);
    expect(fn?.imports).toEqual([]);
  });

  it("extracts an async fn as a function block", () => {
    expect(byName(blocks, "fetch_user")?.blockType).toBe("function");
  });

  it("extracts struct / enum / trait as class blocks", () => {
    expect(byName(blocks, "Auth")?.blockType).toBe("class");
    expect(byName(blocks, "State")?.blockType).toBe("class");
    expect(byName(blocks, "Checkable")?.blockType).toBe("class");
  });

  it("treats a unit struct (struct Unit;) as a 1-line class span", () => {
    const u = byName(blocks, "Unit");
    expect(u?.blockType).toBe("class");
    expect(u?.startLine).toBe(u?.endLine);
  });

  it("extracts an impl block (no plain name) as a class block", () => {
    const impl = blocks.find(
      (b) => b.blockType === "class" && b.name === undefined,
    );
    expect(impl).toBeDefined();
    expect((impl?.endLine ?? 0) > (impl?.startLine ?? 0)).toBe(true);
  });

  it("emits no nested fn blocks (top-level only)", () => {
    // the fn inside impl Auth is nested -> swallowed by the impl span.
    // 'check' must not appear as its own top-level block.
    expect(blocks.filter((b) => b.name === "check").length).toBe(0);
  });

  it("returns [] for a file with no top-level decl", () => {
    expect(extractRs("src/x.rs", "use std::io;\n")).toEqual([]);
    expect(extractRs("src/x.rs", "")).toEqual([]);
  });

  it("never throws and clamps a never-closing brace to EOF", () => {
    const b = extractRs("src/x.rs", "fn open() {\n    1");
    expect(b[0]?.endLine).toBe(2);
    expect(() => extractRs("src/x.rs", "fn {{{")).not.toThrow();
  });

  it("keywords + stable contentHash", () => {
    expect(byName(blocks, "fetch_user")?.keywords).toEqual(
      expect.arrayContaining(["fetch", "user"]),
    );
    const again = extractRs("src/auth.rs", RS_SOURCE);
    expect(byName(again, "validate")?.contentHash).toBe(byName(blocks, "validate")?.contentHash);
  });
});
```

**Implementation (`extract-rs.ts`):**

```ts
import type { ExtractedBlock } from "../code-block.js";
import { hashText, tokenize } from "./helpers.js";

// Top-level Rust decls (heuristic, no parser). fn/pub fn/async fn ->
// function; struct/enum/trait/mod/impl -> class (closest existing enum
// literal for an aggregate/type decl). Block END is brace-balanced; a
// ;-terminated decl (unit struct, `mod foo;`) with no opener spans one
// line. Pure; never throws. Top-level only — nested fns inside impl are
// swallowed into the impl span by design.
const FN_RE = /^(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/;
const TYPE_RE = /^(?:pub\s+)?(struct|enum|trait|mod|impl)\b\s*([A-Za-z_]\w*)?/;

// ponytail: naive brace count — ignores strings/comments/char literals.
// Accepted ceiling (spec: "good top-level spans"); mis-spans stay valid.
function braceDelta(line: string): number {
  let delta = 0;
  for (const ch of line) {
    if (ch === "{") delta += 1;
    else if (ch === "}") delta -= 1;
  }
  return delta;
}

function balancedEnd(lines: readonly string[], start: number): number {
  let depth = 0;
  let opened = false;
  for (let i = start; i < lines.length; i += 1) {
    depth += braceDelta(lines[i] ?? "");
    if (depth > 0) opened = true;
    if (opened && depth <= 0) return i + 1;
  }
  return opened ? lines.length : start + 1; // never-closed -> EOF; no brace -> 1 line
}

export function extractRs(filePath: string, source: string): ExtractedBlock[] {
  const lines = source.split("\n");

  const block = (
    startLine: number,
    endLine: number,
    blockType: "function" | "class",
    name: string | undefined,
  ): ExtractedBlock => ({
    filePath,
    startLine,
    endLine,
    blockType,
    ...(name !== undefined ? { name } : {}),
    contentHash: hashText(lines.slice(startLine - 1, endLine).join("\n")),
    imports: [],
    exports: [],
    calls: [],
    calledBy: [],
    keywords: tokenize(name ?? ""),
  });

  const blocks: ExtractedBlock[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const fn = FN_RE.exec(line);
    const ty = TYPE_RE.exec(line);
    if (fn === null && ty === null) continue;
    const end = balancedEnd(lines, i);
    if (fn !== null) blocks.push(block(i + 1, end, "function", fn[1]));
    else if (ty !== null) blocks.push(block(i + 1, end, "class", ty[2]));
    i = end - 1;
  }
  return blocks;
}
```

> `impl Auth { ... }` matches `TYPE_RE` with group 2 = `Auth`, so an
> `impl Auth` carries `name: "Auth"`. To exercise the **name-less** branch
> the test uses `impl Trait for Type` shape only if present; the sample's
> `impl Auth` DOES capture `Auth`. Fix the test: the name-less impl case is
> `impl Display for Auth { ... }` → group 2 captures `Display`. Since the
> heuristic always captures the first ident after the keyword, a truly
> name-less block does not occur with this regex — drop the "impl (no plain
> name)" assertion and instead assert `byName(blocks, "Auth")` finds **two**
> class blocks (the struct and the impl) by filtering, OR rename the sample
> impl to `impl Auth { ... }` and assert it is a `class` block whose span
> is brace-balanced. Simpler: assert `blocks.filter((b) => b.name === "Auth"
> && b.blockType === "class").length === 2` (struct + impl). Use that.

**Index export — add to `packages/indexer/src/index.ts`:**

```ts
export * from "./extract/extract-rs.js";
```

**Run:** `pnpm --filter @megasaver/indexer test extract-rs`
**Commit:** `feat(indexer): heuristic Rust top-level extractor`

---

## Task 4 — `semantic.ts` dispatch + `semantic-chunk.test.ts` cases

**Files:** `packages/output-filter/src/parsers/semantic.ts` (3 ext regexes,
3 `extractorFor` cases, 3 `isSupportedSource` clauses),
`packages/output-filter/test/semantic-chunk.test.ts` (add per-lang cases),
`packages/output-filter/test/no-eager-typescript.test.ts` (no edit —
confirm stays green).

**Edits to `semantic.ts`:**

After `const TS_EXT = ...` add:

```ts
const PY_EXT = /\.py$/;
const GO_EXT = /\.go$/;
const RS_EXT = /\.rs$/;
```

In `extractorFor`, before `return undefined;`:

```ts
  if (PY_EXT.test(path)) return extractors.extractPy;
  if (GO_EXT.test(path)) return extractors.extractGo;
  if (RS_EXT.test(path)) return extractors.extractRs;
```

In `isSupportedSource`:

```ts
function isSupportedSource(path: string): boolean {
  return (
    TS_EXT.test(path) ||
    PY_EXT.test(path) ||
    GO_EXT.test(path) ||
    RS_EXT.test(path) ||
    path.endsWith(".md") ||
    path.endsWith(".json")
  );
}
```

> `Extractor` is structurally `(filePath, source) => ReadonlyArray<{startLine;
> endLine}>`. The new extractors return `ExtractedBlock[]` which is
> assignable (it has `startLine`/`endLine`), exactly like `extractTs`/
> `extractMd`/`extractJson` already are. No signature change needed.

**Test cases — append inside `describe("chunkBySemantic (T2)")`:**

```ts
  it("aligns chunks to def/class boundaries for a .py file", async () => {
    const text = [
      "import os",
      "",
      "def alpha():",
      "    return 1",
      "",
      "class Beta:",
      "    def m(self):",
      "        return 2",
      "",
    ].join("\n");
    const chunks = await chunkBySemantic(text, "mod.py");
    expect(chunks).not.toBeNull();
    const c = chunks ?? [];
    expect(c.some((k) => k.text.includes("def alpha"))).toBe(true);
    expect(c.some((k) => k.text.includes("class Beta"))).toBe(true);
    assertExhaustivePartition(text, c);
  });

  it("aligns chunks to func/type boundaries for a .go file", async () => {
    const text = [
      "package main",
      "",
      "func Alpha() int {",
      "\treturn 1",
      "}",
      "",
      "type Beta struct {",
      "\tN int",
      "}",
      "",
    ].join("\n");
    const chunks = await chunkBySemantic(text, "mod.go");
    expect(chunks).not.toBeNull();
    const c = chunks ?? [];
    expect(c.some((k) => k.text.includes("func Alpha"))).toBe(true);
    expect(c.some((k) => k.text.includes("type Beta"))).toBe(true);
    assertExhaustivePartition(text, c);
  });

  it("aligns chunks to fn/struct boundaries for a .rs file", async () => {
    const text = [
      "use std::io;",
      "",
      "pub fn alpha() -> i32 {",
      "    1",
      "}",
      "",
      "struct Beta {",
      "    n: i32,",
      "}",
      "",
    ].join("\n");
    const chunks = await chunkBySemantic(text, "mod.rs");
    expect(chunks).not.toBeNull();
    const c = chunks ?? [];
    expect(c.some((k) => k.text.includes("pub fn alpha"))).toBe(true);
    expect(c.some((k) => k.text.includes("struct Beta"))).toBe(true);
    assertExhaustivePartition(text, c);
  });

  it("returns null for an unsupported source extension (.pyc)", async () => {
    expect(await chunkBySemantic("blob\nmore", "mod.pyc")).toBeNull();
  });

  it("returns null when a .py file has zero top-level decls", async () => {
    expect(await chunkBySemantic("x = 1\ny = 2", "consts.py")).toBeNull();
  });
```

> `.pyc` must NOT match `PY_EXT` (`/\.py$/` is end-anchored, so `mod.pyc`
> fails — good). This is the explicit "unsupported ext → null → fallback"
> proof the locked decisions require.

**no-eager guard:** no edit. After building output-filter, the child-process
check (`process.moduleLoadList` typescript count === 0) must still print
`0` because nothing new is statically imported into output-filter — the
three extractors are reached only via the existing lazy
`await import("@megasaver/indexer")`. Re-run it explicitly to confirm.

**Run:**
```
pnpm --filter @megasaver/output-filter build
pnpm --filter @megasaver/output-filter test semantic-chunk
pnpm --filter @megasaver/output-filter test no-eager-typescript
```
**Commit:** `feat(output-filter): dispatch py/go/rust to semantic chunker`

---

## Task 5 — Changeset

**File:** `.changeset/semantic-ast-py-go-rust.md` (new).

```md
---
"@megasaver/indexer": minor
"@megasaver/output-filter": minor
---

Extend semantic AST chunking to Python (.py), Go (.go), and Rust (.rs)
source reads. Three zero-dependency heuristic extractors (extractPy /
extractGo / extractRs) detect top-level declarations (def/class; func/
type/var(/const(; fn/struct/enum/trait/mod/impl) by line scanning and
indentation- or brace-balanced spans — no tree-sitter, wasm, or other
parser dependency. The chunker now produces AST-aligned chunks for those
files instead of fixed line windows; unsupported extensions, parse
failures, and zero-decl files fall back to line chunking as before. The
extractors stay off output-filter's eager import graph (loaded lazily via
@megasaver/indexer), so no per-tool-call start pays a heavier import.
```

**Run:** `pnpm changeset status`
**Commit:** `chore(changeset): semantic AST py/go/rust read`

---

## Final verification (DoD gate, §9)

Run over the committed tree, all green before any "done" claim:

```
pnpm exec biome check <every changed file>   # before each commit
pnpm lint
pnpm typecheck
pnpm test
pnpm conventions:check
```

Feature smoke (library API surface, §9.5b): the per-lang
`chunkBySemantic` tests in `semantic-chunk.test.ts` exercise the public
surface end to end (read text → AST-aligned chunks → exhaustive
partition), which is the integration evidence for a library API feature.

Guard: `apps/cli/test/readme-proxy-mode.test.ts` (README compliance) and
`no-eager-typescript.test.ts` must both stay green — neither is edited;
re-run to confirm no incidental drift.

Then: external `code-reviewer` AND `critic` (HIGH risk, §12) on the whole
branch, in a fresh context (author ≠ reviewer); verifier pass.

## Risk register

- **Mis-span from naive delimiter/indent scan** → chunk still valid;
  `partitionFile` clamps + gap-fills; fallback covers. Accepted ceiling,
  marked with `ponytail:` comments.
- **Throw inside an extractor** → defended (bounds-checked `?? ""`/`?? 0`);
  `chunkBySemantic` try/catch → `null` is the backstop.
- **Eager-import regression** → guarded by `no-eager-typescript.test.ts`;
  extractors import only `type` + `./helpers.js`.
- **Enum drift** → only existing `blockType` literals used; no schema edit.
