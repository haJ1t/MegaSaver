---
"@megasaver/llm-proxy": patch
---

Bound the SSE usage scanner's partial-line buffer.

`createSseUsageScanner` appended every chunk to `leftover` and only drained on a
newline, so a stream that never emitted one grew it without bound — contradicting
the handler's own invariant that streaming size is irrelevant to memory. A
usage-bearing line is one small JSON event, so past `MAX_SSE_LINE_CHARS` the
oversized partial is dropped and the scanner resyncs at the next newline. Usage
totals for well-formed streams are unchanged.
