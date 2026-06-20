---
"@megasaver/memory-graph": patch
"@megasaver/cli": patch
"@megasaver/gui": patch
---

Fix memory `relatedFiles` and wiki `(source:)` citations splitting into two
file nodes when the same path is referenced both ways. `parseWikiPage`
canonicalizes `fileCites` (strips wrapping backticks/quotes, a `:line[-range]`
suffix, and a leading `./`), but both graph loaders only stripped a leading
`./` from `relatedFiles`. A `relatedFiles` entry like `src/x.ts:12` or
`` `src/x.ts` `` therefore produced a distinct file-node id from the wiki
fileCite `src/x.ts`, so the intended single bridged node — carrying both the
`code-link` and the `wiki-cite` edge — never formed.

The path canonicalization is extracted into a pure `canonicalizeFilePath`
helper exported from `@megasaver/memory-graph` (shared + zod only; no fs/yaml).
`parseWikiPage` calls it (fileCite behaviour unchanged), and both the CLI and
bridge loaders apply it to `relatedFiles` at the loader boundary so the same
canonical string feeds both the file-node set and `buildGraph`. `buildGraph`
stays a pure projection.
