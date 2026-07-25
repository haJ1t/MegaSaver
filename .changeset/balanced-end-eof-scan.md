---
"@megasaver/indexer": patch
---

Stop `balancedEnd` in the Go and Rust extractors from scanning to EOF for a
declaration that opens and closes on its own line.

Both copies flipped their `opened` flag from the *end-of-line* delimiter depth,
so a declaration whose start line nets zero — `type ID string`,
`type Message0 = pb.Message0`, `impl Auth {}`, `pub fn f(s: &S) -> u32 { s.f }` —
never set it and the scan ran on. Two consequences, one root cause:

- **Wrong spans.** The scan adopted the *next* declaration's delimiters, so the
  one-line block swallowed it (`type ID string` before a 3-line `func Foo`
  reported lines 1–4) and the swallowed declaration was never emitted at all,
  because the caller resumes at `end - 1`.
- **O(n²).** On a file where such declarations dominate (generated Go type
  aliases, one-line Rust accessors) each of the n declarations walked the
  remaining n lines: 20,000 declarations took 29.2 s (Go) / 49.4 s (Rust);
  they now take 26.4 ms / 26.6 ms. This is on every `.go`/`.rs` read through the
  context gate and every file walked by `mega scan` / `mega index`, whose
  1,000,000-byte file cap left ample room for the blowup.

`opened` now flips on the opening delimiter itself, so a self-closing line ends
the block on that line while a genuinely multi-line declaration — including a
Go signature split across lines, whose `) (*T, error) {` continuation also nets
zero — still balances to its real closing delimiter. The explicit
`;`-terminated guard in the Rust copy is subsumed by the same rule and is gone.
