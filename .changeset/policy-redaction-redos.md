---
"@megasaver/policy": patch
---

fix(policy): bound four quadratic redaction patterns

`redactWithFindings` grew 3.8x-4.7x per doubling on ordinary input — column-padded
tables, tab-indented logs and identifier blobs — because four detectors carried an
unbounded run followed by a required literal. Measured per pattern at 50 KB ->
100 KB: `aws_secret_key` 2.2 s -> 9.4 s, `basic_auth_header` 1.9 s -> 8.4 s,
`api_key_header` 1.3 s -> 7.6 s, `email` 6.0 s -> 23.1 s. Every agent-visible
output path routes through this sink with no size cap ahead of it.

Bounded: the trailing `\s` run of the three lookbehind detectors (`{0,64}` /
`{1,64}`), and the `email` observer's local part (`{1,64}`, RFC 5321's limit).
Each bound is verified load-bearing on its own. Behaviour is unchanged for every
real shape; the two disclosed divergences are a key/value separated by more than
64 whitespace characters and an email local part longer than 64 characters, both
pinned by test.
