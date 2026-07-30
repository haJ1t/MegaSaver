// The one recognizable form every omission record in this package takes: a
// line whose content (after at most a reporter indent) starts with `… [`.
// normalize's collapse passes, every category compressor
// (prose/json/vitest/tsc/diff) and the parser-level omission markers all emit
// it. Each such line is the ONLY record that content was removed (the A1
// honesty contract), so fitBudget recognizes them all through this single
// predicate — a per-emitter regex list drifts the moment one emitter changes
// its wording (SC3-3: the previous two-form list silently excluded every
// compressor marker). New emitters must keep the `… [` prefix.
//
// The indent is bounded, not `\s*`: `^` under `m` re-anchors after every
// separator and `\s` matches them, so an unbounded run would rescan the whole
// remaining separator run from each anchor (see concepts/unbounded-run-redos).
export const EVIDENCE_MARKER = /^\s{0,64}… \[/m;
