---
title: Plan — home credential stores reach the model
date: 2026-07-25
spec: docs/superpowers/specs/2026-07-25-secret-path-home-credentials-design.md
risk: CRITICAL
branch: fix/secret-path-home-credentials
base: origin/main @ 133a95f0
---

# Plan

Strict TDD. Every task states its **red proof** — the command run *before* the
implementation edit and the output that proves the test fails for the right
reason. A task whose red step passes on the first run means the test is vacuous;
stop and fix the test, do not proceed.

Tasks 1–2 close gap (a), 3–4 close the drift found while reproducing, 5–8 close
gap (b), 9–10 fence the three consumers, 11–13 are docs/verify/review.

---

## T1 — Red: the four new path carriers are allowed

**File:** `packages/policy/test/evaluate-path-read.test.ts`

Add positive cases asserting `{ allowed: false, reason: "secret_path_read" }`
for, in both `/`- and `\`-separated and mixed-case spellings:

```
/Users/u/.pgpass
/Users/u/.docker/config.json
/Users/u/.kube/config
/Users/u/.config/gh/hosts.yml
C:\Users\u\AppData\Roaming\postgresql\pgpass.conf
```

Add negatives asserting `{ allowed: true }`:

```
/Users/u/.kube/cache/http/abc
/Users/u/.docker/daemon.json
/Users/u/.docker/contexts/meta/x/meta.json
/Users/u/.config/gh/config.yml
/repo/.npmrc
/repo/pgpassword.txt
/repo/docs/kube/config.md
```

**Red proof:** `pnpm --filter @megasaver/policy test evaluate-path-read`
→ the five positives fail with `allowed: true`; **all seven negatives already
pass**. If a negative fails here, the test is wrong, not the code.

---

## T2 — Green: amend LOCKED §4a

**File:** `packages/policy/src/secret-paths.ts`

Append the five globs from spec §3a to `DENYLIST_GLOBS` (19 → 24), each with the
comment recording *why this filename and not its directory* (spec §3a table).
Export `DENYLIST_GLOBS` from the module — **not** from `packages/policy/src/index.ts`;
T3 needs it and the LOCKED public surface (§2) does not change.

**Verify:** the T1 suite goes green with no negative flipping.
Second check: `pnpm --filter @megasaver/policy test` — `glob-redos`,
`parse-project-permissions` and `evaluate-command` must not regress.

---

## T3 — Red then green: kill the hand-copied denylist

**File:** `packages/policy/test/glob-equivalence.test.ts`

Two edits, in this order so the red is real:

1. Add the non-vacuity assertion **against the existing hand-copy**: every glob
   in the list must be matched by at least one path in `PATHS`.
   **Red proof:** run it — passes, because the hand-copy is the pre-#309
   fifteen and `PATHS` covers exactly those. This is the *demonstration that the
   copy is the bug*: the assertion is satisfiable only because the list is stale.
   Record that output in the PR body.
2. Delete the hand-copy; import `DENYLIST_GLOBS` from `../src/secret-paths.js`.
   **Red proof:** rerun → non-vacuity now fails naming the nine unexercised
   globs (#309's four + this spec's five). This is the failure the copy hid.
3. Extend `PATHS` with one path per unexercised glob (plus the near-miss
   siblings from T1's negatives, so the equivalence oracle sees both sides).

**Verify:** `pnpm --filter @megasaver/policy test glob-equivalence` green;
`legacyCompileGlob` still the oracle and still frozen.

---

## T4 — Red then green: pin spec §4a to the code

**New file:** `packages/policy/test/spec-denylist-parity.test.ts`

Read `docs/superpowers/specs/2026-05-10-bb3-policy-design.md`, extract the fenced
block under `### §4a`, compare line-for-line and in order against
`DENYLIST_GLOBS`. Also assert the prose count line matches the array length.

**Red proof:** run before touching the spec → fails with 15 vs 24, which is the
drift that shipped silently in #309.

Then update §4a: the twenty-four globs, the count line, and an amendment record
naming `5e221055` (#309, four globs) and this spec (five globs), with the
`.npmrc` exclusion carried forward as a recorded decision rather than an absence.

**Verify:** test green. Reference for the import-out-of-package pattern:
`packages/policy/test/redos-probe-parity.test.ts`.

---

## T5 — Red: the three content carriers survive redaction

**New file:** `packages/policy/test/redact-home-credentials.test.ts`

Fixtures, asserting `findings` contains the named detector and the secret is
absent from `redacted`:

| carrier | fixture |
|---|---|
| npmrc legacy uuid | `//registry.npmjs.org/:_authToken=<synthetic-uuid-elided>` |
| npmrc artifactory b64 | `//art.co/api/npm/:_authToken=QWxhZGRpbjpvcGVuIHNlc2FtZQ==` |
| npmrc `_auth` | `//registry.internal/:_auth=dXNlcjpwYXNzd29yZA==` |
| pgpass | `prod-db.internal:5432:payments:svc_payments:Pg-Sup3r-S3cr3t-2026` |
| kubeconfig | `    token: k8s-svc-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abcdef` |

Plus the evidence-preservation negatives from spec §5, asserting `count === 0`
and byte-identical output: `token: yes`, `token: 42`, `PWD=/Users/x/p`,
`a:b:c:d`, `see http://host:8080:x:y:z in prose`, `"token": "abc..."` JSON,
`--auth=short`.

**Red proof:** `pnpm --filter @megasaver/policy test redact-home-credentials`
→ the five positives fail `count: 0`, all seven negatives pass. Both halves
matter: a negative failing now means the fixture is wrong.

---

## T6 — Green: append three detectors

**File:** `packages/policy/src/redaction-patterns.ts`

Append `npmrc_auth`, `pgpass_line`, `kubeconfig_token` from spec §3c, at the end
of `REDACTION_PATTERNS`, each with its rationale comment and its **disclosed
loss** comment (spec §3c) — the house convention is that a bound with no
recorded loss is an undocumented hole.

Add a table-position assertion in the same test file: the three names are the
last three entries, and `jwk_private_key` / `jwt` are still ahead of every prefix
detector (`redact-jwt-order.test.ts` covers the second half already).

**Verify:** T5 green. Then `pnpm --filter @megasaver/policy test` whole-package —
`redact.property`, `redact-pii`, `redact-unstructured`, `redact.test` must not
move. Any changed `count` in an unrelated test is a false positive from a new
detector; treat it as a real defect, not a fixture update.

---

## T7 — Red then green: ReDoS fence

**File:** `packages/policy/test/redact-superlinear.test.ts`

Add for each of the three: a `.source` byte pin, a `.flags` pin, and a growth
row measuring n vs 4n on a hostile input (long non-matching run behind a valid
prefix — a `.pgpass`-shaped line whose fifth field never terminates; an
indented `token:` line of pure whitespace; `_auth=` followed by a long
quote-free run).

**Red proof:** temporarily replace each bound with an unbounded quantifier and
each `(?=\S)` guard with nothing, rerun, and record the ratio blowing the
ceiling. Restore. A growth test that passes against the deliberately broken
pattern is measuring the wrong input — see `concepts/redos-growth-ratio-measurement`
(minimise per size, not per ratio; 4x step; do not run under a parallel `turbo`).

**Verify:** growth ratios within ceiling; `redact-redos` and `glob-redos` still green.

---

## T8 — Green: probe rows

**File:** `scripts/redos-probe.mjs`

Add the three to `NEW_DETECTORS` with seeded corpora (a corpus with no anchor
reports zero divergences and proves nothing — each row must print a non-zero
match count). Bump the parity test's non-vacuity floor from 21 to 24.

**Red proof:** add the probe rows with one byte deliberately wrong, run
`pnpm --filter @megasaver/policy test redos-probe-parity` → fails naming the
drifted row. Fix the byte → green. This proves the existing parity guard now
covers the new rows.

---

## T9 — Red then green: the command path

**File:** `packages/policy/test/evaluate-command.test.ts`

**Red proof:** run against T2's tree — these already pass, because T2 fixed the
shared table. So write them *before* T2 if running strictly, or record them as
**regression fences** rather than red-first tests and say so in the PR. Either
way they must exist: this is the second consumer the original report did not
name, and nothing else asserts it.

Cases: `cat ~/.pgpass`, `grep -r x ~/.kube/config`, `tail ~/.config/gh/hosts.yml`
→ denied `secret_path_read`. `ls ~/.kube`, `cat ~/.docker/daemon.json` → allowed.
One flag-attached form: `grep --include=.pgpass -e = .` → denied (the post-`=`
tail is a candidate path).

---

## T10 — Green: the read path and the export path, end to end

Two integration fences, one per remaining consumer:

- `packages/context-gate/test/` — `runTwoGates` (and `runOverlayTwoGates`) return
  `{ ok: false, code: "path_denied", reason: "secret_path_read" }` for the four
  new carriers under a temp `$HOME`. This is the exact shape the reproduction
  drove; without it the fix is asserted only at the unit layer.
- `packages/core/test/` (handoff) — a diff hunk touching `.kube/config` is
  dropped from the export payload, a hunk touching `.kube/cache/x` is kept.

**Verify:** `pnpm --filter @megasaver/context-gate test` and
`pnpm --filter @megasaver/core test`.

---

## T11 — Docs, in the same commit as the code

- `docs/superpowers/specs/2026-05-10-bb3-policy-design.md` §4a — done in T4.
- Same spec §5b — three rows added to the post-lock detector table with this
  spec as owning spec and `bytes + flags` as the pin, plus the disclosed-gap
  rows for the three new detectors.
- `wiki/entities/policy.md` — denylist now 24 globs; three new detectors; the
  drift class and how it was closed.
- `wiki/concepts/unbounded-run-redos.md` — no new instance (nothing regressed),
  but record the three new bounded patterns in `sources:` if the page's
  convention requires it; otherwise leave alone.
- `wiki/log.md` — timestamped entry.
- `.changeset/` — `@megasaver/policy` patch; the public surface does not change
  (§3d keeps `DENYLIST_GLOBS` out of `index.ts`) but behaviour does.

---

## T12 — Verification evidence

1. `pnpm verify` green — paste the tail, not the whole log.
2. Re-run the §1a reproduction harness under a throwaway `$HOME`: all four new
   path carriers `gate=DENIED reason=secret_path_read`, `.npmrc` still
   `gate=ALLOWED` **and** now `findings=[npmrc_auth]`, the three content
   carriers `count>=1`.
3. `git diff origin/main --stat` — confirm nothing outside `packages/policy`,
   the two integration test files, `scripts/redos-probe.mjs`, the two spec files,
   the wiki and the changeset was touched.

No "done" claim before all three exist as pasted output
(`superpowers:verification-before-completion`).

---

## T13 — Review (CRITICAL gate, CLAUDE.md §12)

Three separate passes, none in this authoring context:

- `code-reviewer` — the diff.
- `critic` — adversarial, specifically: is any of the five globs over-broad, and
  does any of the three detectors destroy evidence?
- `security-reviewer` — the leak is closed on all three consumers and no fourth
  consumer of `evaluatePathRead` was added or missed
  (`git grep -n 'evaluatePathRead\|SECRET_PATH_PATTERNS' packages apps`).

Then `superpowers:finishing-a-development-branch`.

---

## Ordering note

T1→T2 must precede T9/T10, because those assert the same table from further out
and would be red for the same reason. T5→T6→T7→T8 is a chain: do not add probe
rows before the patterns exist, or T8's parity guard has nothing to pin against.
T3 and T4 are independent of the redaction chain and can run in parallel with it.
