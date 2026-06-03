---
"@megasaver/output-filter": patch
---

Broaden the output-filter ranker's failure markers so Phase-3a parser chunks
score correctly. The ERROR signal now matches CamelCase exception names
(`ZeroDivisionError`, `AssertionError`, `TypeError`, `ParseError`) via a
case-sensitive `[A-Z][A-Za-z]*Error\b` arm, and the panic signal matches
Rust's `panicked` (`\bpanic(ked)?\b`). Previously a pytest `ZeroDivisionError`
traceback or a Rust `panicked … ParseError` block scored as low as 1 (file
path only) while its summary line scored ~9, so failures under-ranked
passing-run noise. Lowercase `error` keeps its existing `\berror\b/i`
precision, so benign prose like "error handling is configurable" is not
over-boosted.
