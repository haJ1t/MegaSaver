# Track A (architecture) — code review

- **Reviewer:** fresh Opus 5 context, not the author. No access to the author's reasoning beyond what is in the commits and the spec.
- **Under review:** `38bb2993, 225a0279, 9fbd9cfe, cc9c6395, eb7490b4, bdaef5eb, 93cf6a8c` at `c1d37849` (detached worktree `MegaSaver-review`).
- **Risk:** CRITICAL.
- **Method:** read the sources, then ran probes against the built `dist/` to confirm or kill each hypothesis. Every "Evidence" line below is a command I ran, not a reading. Probe scripts were written under `MegaSaver-review/tmp-review/` and deleted afterwards; the review worktree is clean and no source was modified.

**Verdict: 1 BLOCKER, 1 MAJOR, 3 MINOR, 2 NIT.** The BLOCKER is A3's own defect class, reachable on a common class of real tool output. The MAJOR is the exact pattern the handoff asked me to hunt for (item 4), still live in four places.

---

### BLOCKER — gap markers and stored chunks are still in different coordinate systems whenever `normalize()` changes the line count

**Where:** `packages/output-filter/src/types.ts:222-227` (marker space) vs `packages/context-gate/src/recoverable-chunks.ts:22-28` and `packages/context-gate/src/record-output.ts:167-170` (chunk space).

**Why it is wrong:** A3's contract is that delivered line numbers and stored chunks inhabit one coordinate system. They do not. The two sides derive from different text:

- Marker space: `rawLineCount = normalize(redacted).split("\n").length` — **after** `normalize()`.
- Chunk space: `chunkByLines(redact(raw), 40)` — `normalize()` is never called on this path.

`normalize()` is not line-count-preserving. `.replace(/\r/g, "\n")` (normalize.ts:16) turns every bare CR into a newline, **adding** lines; and the OSC branch of the ANSI regex, `\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)` (normalize.ts:2), has a negated class that also matches `\n`, so a multi-line OSC payload **removes** lines. Either way the two spaces drift, and `returnedTextOf` (record-output.ts:88-97) publishes marker numbers in the space the chunks do not index.

Bare CR is not exotic in this codebase's input: it is how npm, pip, curl, wget, docker, cargo and pytest draw progress bars, and the saver's highest-volume entry point is a Bash `PostToolUse` hook. ANSI escapes are stripped from the delivered text but CRs are not stripped from the stored chunks.

The failure is not a near-miss. On a build log with 200 progress-bar lines the delivered text names line 1001; the published `~40 lines each` rule resolves that to chunk 25; only chunks 0–10 exist, and the footer itself advertises `i = 0..10`. The agent is handed an unfetchable pointer by a footer that says "Full output recoverable". In the shrink direction the failure is worse because it is silent: the marker resolves to a real chunk holding unrelated content — precisely the "agent probes blindly, compressed view + N expansions costs more than the raw read" outcome A3 was written to remove.

The A3 test does not catch it because its own load-bearing assertion — `Math.max(...namedLines) === rawLines.length` (recovery-addressability.test.ts:96-103) — is exactly the invariant that breaks, and `driftingCorpus()` contains no CR and no OSC. The A1 property test cannot catch it either, by construction: `assertNothingLost` (save-integrity.property.test.ts:62-73) tests *containment* — every redacted raw line appears somewhere in `delivered + recovered` — and since each path's recovery set is that path's own full redacted raw, containment holds on every path whether or not the addressing is sound. A1 proves the bytes are there; nothing proves the marker can find them.

Dogfood note, offered as motivation rather than as an instance of the bug: this review was conducted through the saver itself. Every `Read` and `git show` in the session came back with `… [lines N-M omitted]` markers and a `Full output recoverable … i = 0..N` footer, and I switched to sliced reads because the compressed view was too lossy to review from. TypeScript sources and diffs carry no bare CR, so none of those markers were skewed — but they are the same marker-and-footer surface this finding is about, and it is the surface an agent actually acts on.

**Fix surface:** both chunkers (`recoverable-chunks.ts:22-28` and the duplicate at `record-output.ts:167-170`, see the MINOR below) must agree with `types.ts:222-227` on which text defines line space. Outline mode does **not** need touching — it renders its excerpt via `excerptOf(..., null)` (types.ts:250), so `addressable` is false and it emits a countless marker rather than any raw line number.

**Scope (checked, narrower than "all input"):** LF and CRLF are both safe. This is bare-CR and multi-line-OSC only, which in practice means command/tool output, not ordinary file reads. `read.ts:264` passes file bytes through the same skew, but a CRLF file has equal counts under both splits, so file reads are only affected by classic-Mac-CR files.

**Evidence:**

```
# skew by line-ending class (source: file)
LF only                markerSpace=120  storedSpace=120  skew=0
CRLF (windows file)    markerSpace=120  storedSpace=120  skew=0
bare CR x1             markerSpace=121  storedSpace=120  skew=1
bare CR x50            markerSpace=180  storedSpace=120  skew=60

# 200 progress-bar lines + 200 log lines + 1 error line, mode balanced
marker space rawLineCount: 1001 | stored space lines: 401 | chunks: 11
sentinel TRULY in stored chunk: 10
delivered claims rawEndLine 1001 -> agent fetches chunk 25 (OUT OF RANGE — unfetchable)
trailing gap marker would name up to line 1001; highest line any stored chunk holds: 401

# shrink direction, multi-line OSC payload
marker-space rawLineCount: 300 | stored-chunk-space lines: 302
skew: -2 (negative => markers resolve to EARLIER chunks)
```

**Checked and dropped:** `redact` vs `redactWithFindings` is not a second skew source — `redact` (policy/src/redact.ts:44-47) delegates to `redactWithFindings` and returns its `redacted` verbatim, so both sides redact byte-identically.

---

### MAJOR — A4's target ratio is suppressed everywhere except the PostToolUse hook

**Where:** `apps/cli/src/commands/session/saver/enable.ts:73`, `packages/core/src/token-saver.ts:34`, `apps/gui/bridge/routes/claude-session-token-saver.ts:155`, `apps/cli/src/commands/bench.ts:188`.

**Why it is wrong:** This is handoff item 4, and the answer is yes — the same pattern is live in four more places. `record-output.ts:125-132` correctly stopped passing a redundant `maxReturnedBytes`, with a comment explaining that the field means "the caller named an explicit size" and therefore suppresses the mode ratio. But four other sites fill that field with exactly the default it defends against:

- `enable.ts:73` writes `maxReturnedBytes: modeToBudget(parsedMode)` **into the session record**. It then flows `resolveEffectiveSettings` (read.ts:74) → `filterRaw` / `runOutputExecCommand` → `filterOutput` → `targetBudget`, which returns `min(maxReturnedBytes, HARD_CEILING)` and never consults `MODE_TARGET_RATIO`. Every session enabled through the CLI pins the registry read and exec paths to the mode ceiling — the fixed-size-truncator behaviour A4 exists to remove.
- `defaultTokenSaverSettings` hardcodes `maxReturnedBytes: 12_000`, which is `modeToBudget("balanced")`. Same suppression for every consumer taking the default.
- The GUI bridge route does the same for sessions enabled from the panel.
- `bench.ts:188` passes it too, so **the benchmark harness measures pre-A4 behaviour**.

A4 only bites when `rawBytes * ratio < modeBudget` — under ~32 KB (aggressive), ~48 KB (balanced), ~64 KB (safe). That is the band the §7 table reports as A4's win, and it is the band where these four sites cancel it.

Sizing the §7 implication honestly: the table is labelled "hook path", and the hook path is the one path A4 actually reaches, so the table is not falsified. What is overbroad is the sentence under it — "The ratio is now a floor set by policy rather than a function of how far the input exceeded a constant." That holds on one of four paths. On the other three the ratio is still a function of how far the input exceeded a constant. And `mega bench` cannot be used to confirm A4 at all until line 188 is removed.

**Evidence:**

```
balanced raw=20099B
   A4 target ratio        -> 4996B  saved 75.1%
   maxReturnedBytes=12000 -> 9995B  saved 50.3%   <-- what enable.ts/bench.ts/defaults send
safe raw=37879B
   A4 target ratio        -> 15101B saved 60.1%
   maxReturnedBytes=32000 -> 20180B saved 46.7%   <-- what enable.ts/bench.ts/defaults send
```

---

### MINOR — the no-blind fallback warning names a cause that did not occur

**Where:** `packages/output-filter/src/types.ts:382-384`.

**Why it is wrong:** The warning reads `specialized compression produced no excerpts; returned generic excerpt`. It is emitted whenever `kept.length === 0`, but that has two causes and only one is a compressor: the block's own comment (types.ts:~365-370) lists "every chunk exceeds the byte budget" as the second. For generic or low-confidence output, `compressorEligible` (types.ts:160-163) is false, so no specialized compressor ever ran, and the warning asserts a step that did not execute. An operator debugging a thin result is pointed at `compress/` when the actual cause is that the target budget is smaller than one 40-line chunk.

**Evidence:**

```
classification: {"category":"unknown","confidence":0}
compressor actually used: generic
warnings: ["specialized compression produced no excerpts; returned generic excerpt"]
```

**Deliberately not escalated.** I first read the accompanying behaviour — the fallback returns one truncated chunk, bypassing rank-and-fit across the rest of the output — as an A4 regression. Measuring pre-A4 against post-A4 at matched sizes does not support that. Aggressive already fell into the fallback at ≥15 KB before A4; the only genuinely new cases are aggressive at ~7 KB and balanced at ~15 KB, and both are the arithmetic consequence of a tighter target against 40-line chunk granularity, which is A4's stated design. Reporting it as a defect would be inflating a chosen trade-off.

```
mode      rawKB   PRE-A4                POST-A4
aggressive   7KB    1, fit                1, FALLBACK   <- new
aggressive  15KB    1, FALLBACK           1, FALLBACK
aggressive  30KB    1, FALLBACK           1, FALLBACK
balanced    15KB    2, fit                1, FALLBACK   <- new
balanced    30KB    2, fit                1, fit
balanced    49KB    2, fit                2, fit
safe        49KB    6, fit                5, fit
```

---

### MINOR — `recoverable-chunks.ts` claims to be the single source for every entry point; the highest-volume path does not use it

**Where:** `packages/context-gate/src/recoverable-chunks.ts:6-7` vs `packages/context-gate/src/record-output.ts:167-177`.

**Why it is wrong:** The module header says it is "the single source of recovery content for every entry point". Four of the five chunk-persistence sinks call it. The fifth — the PostToolUse hook, which carries the most traffic — reimplements it inline: same `redact`, same `chunkByLines(…, OVERLAY_CHUNK_LINES)`, same empty-input special case, same `id/startLine/endLine/bytes/text` mapping, all duplicated. A2's whole thesis is that four sinks disagreeing is what caused the defect; this leaves two.

Concrete failure mode: any hardening applied to `recoverableChunks` — a stricter redactor, a different chunk size, a normalization fix (see the BLOCKER, whose fix must land in **both** copies) — silently misses the hook path, and no test would notice. I read the A1 property test to confirm this rather than assume it: it exercises each path independently and asserts containment per path (`assertNothingLost`, :62-73); no assertion anywhere compares the two chunkers' output to each other, so they can diverge arbitrarily while all 9 cases stay green.

**Evidence:** the five sinks, enumerated — `read.ts:266`, `read.ts:293`, `run-command.ts:398`, `run-command.ts:659` all route through `recoverableChunks`; `record-output.ts:302` persists chunks built at `:167-177` inline.

---

### MINOR — retention does not bound the volume A2 added

**Where:** `apps/cli/src/hooks/gc.ts:79-115`, `packages/content-store/src/store.ts:260-338`.

**Why it is wrong:** This is handoff item 1's second half. GC is **age-only**: a 30-day cutoff, throttled to once per day, honouring pins. There is no size cap, no count cap, and no per-workspace quota anywhere in the sweep. A2 changed three of four paths from persisting `filtered.excerpts` (bounded by the mode budget, 4–32 KB) to persisting the full redacted raw (bounded only by the caller's `maxBytes` per capture). Steady-state disk therefore grows by the same multiple the fix introduced, and the only thing that returns it is the passage of 30 days.

Stated plainly because it is what was asked: this is a **volume and exposure-window** finding, not a redaction bypass. Redacted secrets are not on disk. Everything else the tool printed is, for 30 days, in far greater quantity than before — and the sweep only runs when a hook happens to fire, so an idle workspace never reclaims.

**Evidence:** `maybeRunOverlayGc` computes one cutoff, `new Date(now() - OVERLAY_RETENTION_MS)`, and passes it to `pruneChunkSetsHonoringPins`; `pruneOlderThan` walks `content/` and deletes strictly on `mtime`/`createdAt` versus that cutoff. No branch in either function reads a file size or a directory total.

---

## Checked, and it holds

The handoff asked three questions I could not turn into findings. Recording the results, per the README.

**Redaction cannot be bypassed on any of the three new paths — or any of the five.** I enumerated every `saveChunkSet` / `saveOverlayChunkSet` call site in the repo (5, listed in the MINOR above). Four derive content from `recoverableChunks`, whose first statement is `redact(raw)` (recoverable-chunks.ts:22) — the redaction sits *inside* the shared helper, so it is not something a new caller can forget. The fifth redacts inline at `record-output.ts:155`. The one branch that skips `recoverableChunks` is outline mode (`read.ts:255-264`), and it is also clean: `outline.chunks` derive from `normalized`, which derives from `redacted` (types.ts:208-238). I also checked the non-chunk sinks A2 touches — `appendOverlayFailure` and `createSessionFailure` redact the full raw *before* slicing to 4000 chars (run-command.ts:307, :216), which is the right order; and `captureGuardCorpusRow` receives `raw` but stores only `estimateTokens(raw)`, never the text (guard-corpus.ts:79-85).

**The `normalize.ts` span arithmetic is correct within its own space.** Both passes are fold-only and their spans are sound. `collapseRepeatedLinesTraced` gives the marker `{spanAt(i).start, spanAt(i+run-1).end}` — the whole run including the first occurrence, which is right because the marker is the only delivered token accounting for the folded lines; the deliberate overlap with the first line's own span is documented and harmless, since no consumer requires monotonic non-overlapping starts. `collapseSimilarTraced` gives the marker `{spanAt(i+1).start, spanAt(i+run-2).end}` — the middle only, correct because first and last survive verbatim with their own spans, and the `run >= 3` guard makes the middle non-empty. Pass-1 markers survive pass 2 untouched (`maskTemplate` leaves them unchanged, so `template === line` short-circuits at :126). I also checked the other way provenance could lie: every format parser (`pytest`, `cargo-test`, `go-test`, `eslint`, `test-output`, `ts-diagnostic`, `stacktrace`, `semantic`) numbers its chunks against the text it was handed, so when `compressorEligible` is false the chunk line numbers do index `normalized`. **Every surviving line does map to a contiguous span — of the normalized text.** The BLOCKER is that the normalized text is not the text the chunks index; it is not an error in this arithmetic.

**Evidence-marker reservation does not starve real content in any case I could build.** `fitBudget` (fit.ts:31-41) reserves the intent pin, then marker-bearing chunks, then score order, each yielding to the budget. I constructed two adversarial fixtures — one where markers occupy 4 of 5 delivered excerpts and 8226 of ~8300 returned bytes, one with two spatially separated intent matches competing against 60 marker-bearing blocks. In both the intent-matched content was delivered. The reason it holds: a marker-bearing chunk is a whole 40-line chunk that carries a marker, not a bare marker, so "crowded out by markers" still delivers surrounding content, and the intent pin is reserved ahead of markers. Two attempts, both clean; reporting it as a result rather than continuing to fish.

---

## NITs (no concrete failure mode found — recorded, not charged)

**`EVIDENCE_MARKER` matches on content, so it is spoofable.** `fit.ts:11` tests chunk *text* against `/^… \[(?:repeated \d+ times|\d+ similar: )/m`. Tool output that legitimately prints such a line gets budget priority over higher-scored chunks. Requires a tool to emit Mega Saver's own marker syntax; I could not name one.

**Only the single best intent match is pinned.** `fit.ts:19` takes `ordered.find(c => c.features.keywordScore > 0)`. Intent match #2 has no priority over marker-bearing chunks even when it outscores all of them. I could not construct a case where this actually loses content (see above) — the structural observation stands without a failure.

**`excerptOf`'s index fallbacks fabricate rather than omit.** `types.ts:177-178` reads `(spans[chunk.startLine - 1] ?? spans[0])?.start`. The design principle stated three lines above is that fields are "absent rather than approximated"; `?? spans[0]` approximates to line 1 instead. I traced every producer of `chunk.startLine` — parsers, semantic chunker, no-blind fallback, `truncateChunkToBytes` (which correctly shrinks `endLine` with the text) — and found no path that can index out of range, so this is unreachable today. It is a guard that would hide the next provenance bug rather than surface it.

---

## Note on the "gate that is NOT met"

I did not re-litigate it — the handoff already states it correctly and I agree with the framing. One thing to add from the MAJOR: `bench.ts:188` means the ratio harness itself is not measuring A4, so when the real-API benchmark is finally run, that line has to go first or the run will measure the pre-A4 shape on the very paths A4 was supposed to change.
