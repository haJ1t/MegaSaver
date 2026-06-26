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
