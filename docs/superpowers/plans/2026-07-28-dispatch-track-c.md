# Track C — Task Packet (Gemini Flash 3.6)

**Worktree:** `/Users/ozger/Desktop/MegaSaver-saver-c-defects`
**Branch:** `feat/saver-c-defects` (from `docs/saver-integrity-spec`)
**Risk:** MEDIUM. **Spec:** `docs/superpowers/specs/2026-07-28-saver-compression-integrity-design.md`

## Rules — read before touching anything

1. **TDD is mandatory.** Write the failing test first, watch it fail, then fix.
   The exact assertions are given below — implement them as written.
2. **You own exactly these five files. Do not edit any other source file:**
   ```
   packages/output-filter/src/tokenize.ts
   packages/output-filter/src/rank.ts
   packages/retrieval/src/bm25.ts
   apps/cli/src/hooks/saver.ts
   ```
   Plus test files for these. `types.ts`, `fit.ts`, `normalize.ts`,
   `record-output.ts`, `read.ts`, `run-command.ts` belong to Track A —
   **if your fix seems to need one of those, stop and report instead.**
3. **Do not choose lists, thresholds, or data structures.** Everything you need
   is specified. If something is genuinely unspecified, ask — do not invent.
4. **Merge early and often.** C2 and C3 move the ranking baseline that Tracks A
   and B pin fixtures on. Land each task as its own commit as soon as it is green.
5. `pnpm` is not on PATH. Run tests with:
   `cd packages/<pkg> && ../../node_modules/.bin/vitest run`
   For `apps/cli`: `cd apps/cli && ../../node_modules/.bin/vitest run`
6. Baseline is green (output-filter 451, retrieval 43). Any failure you see is
   yours.

---

## C1 — `filenames` rebuild corruption (do this first)

**File:** `apps/cli/src/hooks/saver.ts:179-186`

**Defect.** For Grep (`files_with_matches`) and Glob, the tool response carries
`filenames: string[]`. The saver joins them with `\n`, compresses the text, then
splits the compressed text back into the array. The compressed text contains the
summary line, `… [lines X-Y omitted]` markers, and the recovery footer — so those
become entries in `filenames`, i.e. **fake file paths**. `numFiles` is preserved
through `...o` and still reports the original count.

Consequence: the model may try to open files that do not exist.

**Required behaviour.** The rebuilt `filenames` array contains **only** strings
that were present in the original `filenames` input. Non-path content produced by
compression (summary, gap markers, footer) must not enter the array. `numFiles`
must agree with the rebuilt array length.

**Test assertions (write these first):**
- Given `filenames` of 500 real paths that compresses, every element of the
  rebuilt array is a member of the original input array.
- The rebuilt array contains no element matching `/^\d+ kept, \d+ dropped$/`,
  none containing `[Mega Saver:`, and none matching `/^… \[lines /`.
- `numFiles` in the rebuilt response equals the rebuilt array's length.

---

## C2 — stop-word leakage in intent matching

**Files:** `packages/output-filter/src/tokenize.ts`, `packages/output-filter/src/rank.ts:84-92`

**Defect.** `tokenizeForMatch` applies no stop-word filter. `keywordScore` counts
how many intent tokens appear in a chunk, and `rank.ts:132-133` weights it
`features.keywordScore + features.keywordScore * INTENT_MATCH_BUMP` — i.e. **×21**.
So a prompt containing "the", "in", "is", "bu", "ve" gives nearly every chunk a
large bump, and intent ranking degenerates into noise.

**Required behaviour.** Stop words are removed from the *intent* side before
matching. The chunk side is unchanged. If filtering empties the intent token set,
`keywordScore` returns 0 (same as today's `wanted.size === 0` branch).

**Use exactly this list — do not add to it, do not translate it, do not source it
from a package.** It is an inline constant in `tokenize.ts` (decision recorded:
a matching stop-list is not a user-facing string, so §11's i18n rule does not
bind; it stays inline until an i18n layer exists).

```
English: a an and are as at be by can could do does for from had has have how
         i if in into is it its of on or should that the their then there these
         they this to was were what when where which who will with would you your

Turkish: acaba ama ancak bana bir biri birkac bu bunu da daha de defa diye eger
         en gibi hem hep her hic icin ile ise kez ki kim mi mu mi ne neden nerde
         nerede nasil niye o sanki sen siz su tum ve veya ya yani
```

Turkish entries are written **without diacritics on purpose**: `tokenizeForMatch`
already NFD-normalises, strips combining marks and folds `ı→i` before comparison,
so `nasıl` arrives as `nasil` and `için` as `icin`. Match against the folded form.

**Test assertions (write these first):**
- `tokenizeForMatch` behaviour itself is unchanged (it is used symmetrically
  elsewhere) — the filter applies where the *intent* set is built.
- Intent `"the login bug in src/auth.ts"` against a chunk containing only the
  word `the` scores `keywordScore === 0`.
- Intent `"the login bug in src/auth.ts"` against a chunk containing `login`
  scores `keywordScore >= 1`.
- Intent `"nasıl çalışıyor bu fonksiyon"` against a chunk containing only `bu`
  scores `keywordScore === 0` (proves the diacritic folding path works).
- An intent consisting only of stop words scores `keywordScore === 0` for every
  chunk, and does not throw.

**Expect existing tests to change.** Some fixtures pin selected excerpts and will
shift because ranking changes. That is expected — update them, and say in the
commit body which ones moved and why.

---

## C3 — BM25 identifier splitting

**File:** `packages/retrieval/src/bm25.ts:33-38`

**Defect.** `tokenize` is `text.toLowerCase().split(/\W+/)`. Two problems:
`parseConfig` stays one token so a query for `parse` or `config` never matches it,
and `\W` is ASCII-only so non-ASCII terms are mis-split.

**Required behaviour.** Tokenisation additionally splits identifiers, and is
Unicode-aware. Both the document side and the query side use the same function
(they already do — keep it that way).

Splitting rules, applied after lowercasing is *not* enough — split before folding
case, because case is the signal:
- `camelCase` / `PascalCase` → split at each lower→upper boundary
- `snake_case` / `kebab-case` / `dot.case` → split at the separator
- consecutive capitals followed by a word: `HTTPServer` → `HTTP`, `Server`
- digits attached to letters stay attached (`utf8` stays `utf8`)
- **keep the unsplit original token as well as its parts**, so an exact query for
  `parseConfig` still scores at least as high as before

Use `\p{L}\p{N}` classes with the `u` flag instead of `\W`.

**Test assertions (write these first):**
- `parseConfig` produces tokens including `parseconfig`, `parse`, `config`.
- `getUserById` produces `get`, `user`, `by`, `id` (plus the whole).
- `auth_token_gen` produces `auth`, `token`, `gen` (plus the whole).
- `HTTPServer` produces `http`, `server` (plus the whole).
- `utf8` produces `utf8` and is not split into `utf`/`8`.
- A query for `parse` ranks a document containing `parseConfig` above a document
  that contains neither.
- A document containing `parseConfig` still ranks at least as high for the query
  `parseConfig` as it did before the change.

---

## C4 — safe-mode Bash dead zone

**File:** `apps/cli/src/hooks/saver.ts:33,54`

**Defect.** `BASH_COMPRESS_FLOOR = 24_000` is the eligibility floor for Bash, but
in safe mode the fit budget is `modeToBudget("safe") = 32_000`. Claude Code
truncates Bash output around 30 000 chars before the hook sees it. So a Bash
output that passes the 24 KB floor is almost always under the 32 KB budget:
nothing gets dropped, the net-negative guard fires, and the result is passthrough.
The whole pipeline runs and discards its own work.

**Required relationship (this is the specification, not the numbers):** for any
mode, the Bash eligibility floor must be **strictly greater than** the fit budget
that will be applied to Bash output in that mode — otherwise compression is
guaranteed to be a no-op. Encode that as an invariant, not as a new magic number.

**Test assertions (write these first):**
- For every `TokenSaverMode`, `minBytesFor("Bash", mode) > ` the budget that will
  be applied for that mode. Assert it as a loop over all three modes so a future
  mode cannot silently reintroduce the dead zone.
- A safe-mode Bash payload just above the floor produces a `compressed` decision,
  not `passthrough`.

**If satisfying the invariant requires changing a value that lives outside your
five files** (e.g. `modeToBudget` in `packages/shared`), **stop and report** —
do not edit it.

---

## C5 — single-slot stdout/stderr

**File:** `apps/cli/src/hooks/saver.ts:124-133`

**Defect.** When a tool response has both `stdout` and `stderr`, the code picks
whichever string is longer and compresses only that one. The existing comment
concedes the gap: two comparable streams, each below the floor but jointly above
it, both pass through raw.

**Required behaviour.** The size gate considers the **combined** length of both
streams. When the combined length clears the floor, both streams are compressed
and the `stdout`/`stderr` split is preserved in the rebuilt response (do not merge
them into one field).

**Test assertions (write these first):**
- Two streams of 15 KB each, floor 24 KB: today both pass through; after the fix
  the decision is `compressed` and **both** fields are shorter than their inputs.
- A response with only `stdout` behaves exactly as before (regression guard).
- A response with only `stderr` behaves exactly as before (regression guard).
- The rebuilt response still has separate `stdout` and `stderr` keys, and every
  other field of the original object is preserved.

---

## Definition of done

- Each task its own commit, conventional-commit format, subject ≤50 chars,
  imperative. Body explains **why**, not what.
- All owned packages green: `output-filter`, `retrieval`, `apps/cli`.
- Report which pre-existing fixtures changed because of C2/C3 and why.
- Review: C1/C4/C5 → Kimi K3. **C2/C3 → Opus 5** (they move the ranking baseline
  other tracks depend on).
- Do **not** merge to `main` yourself. Push the branch and report.
