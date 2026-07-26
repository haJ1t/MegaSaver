# Stop `redos-probe.mjs` measuring regexes that do not ship

- Status: user-approved design
- Risk: **MEDIUM** — dev tooling and one new test. No shipped regex changes,
  no package public API change, so no changeset.
- Builds on `fix/policy-carrier-residuals` ([[docs/superpowers/specs/2026-07-26-carrier-residual-gaps-design]]),
  which fixed the two live drift instances. This closes the class.

## 1. Problem

`scripts/redos-probe.mjs` reproduces every timing figure the redaction specs
cite, and it hand-writes the regexes it measures — 28 of them across two
tables (`AFTER`, 7; `NEW_DETECTORS`, 21).

A drifted copy does not fail. It quietly benchmarks a pattern that does not
ship, and the number lands in a spec looking exactly like a real one.

Confirmed instance: the probe's `connection_string_secret` carried a `pwd`
field in its alternation for months after `pwd` was dropped from production
(it collides with `$PWD`, which appears in every env dump). Every figure that
row produced described a regex that does not exist. A second row,
`gitlab_token`, drifted in the same change.

## 2. Why not the proposed "import the built dist" fix

The task proposed having the probe import `packages/policy/dist/index.js` and
read `REDACTION_PATTERNS` directly, calling it the real fix because the "after"
side would never be transcribed. It does not work as stated, for three
independent reasons:

1. **`REDACTION_PATTERNS` is not exported.** `packages/policy/src/index.ts`
   re-exports only the public surface, per CLAUDE.md §8; tests reach the table
   by relative path inside the package. Exporting it would widen a package's
   public API to serve a measurement script, and `package.json` `exports` has a
   single `.` entry, so there is no subpath to reach it through either.

2. **It trades transcription drift for staleness drift.** A `dist` import is
   only as truthful as the last build. Edit the source, run the probe without
   rebuilding, and it silently measures the *previous* pattern — the same bug
   class, relocated and harder to spot, because nothing about the probe's
   output would look different. Closing that hole needs an mtime check, which
   is more machinery than the thing it guards.

3. **It gives up no-build runnability.** `node scripts/redos-probe.mjs <mode>`
   currently works on a fresh clone. The task flagged this as worth preserving
   or consciously giving up; there is no reason to give it up for a fix that
   introduces (2).

## 3. Design — loud, not impossible

The task allows "impossible **or** loud". This takes loud, but with option 2's
rigor: the check compares **real `RegExp` objects**, not text parsed out of the
probe file, which is what made option 1 sound fragile.

**`scripts/redos-probe.mjs`**
- `AFTER` and `NEW_DETECTORS` become `export const`.
- `BEFORE` and `CARRIER_BEFORE` stay private. They hold superseded patterns
  whose whole purpose is to differ from what ships; asserting over them would
  be wrong, and leaving them unexported makes that mistake unreachable.
- The CLI dispatch and `assertSeedsMatch()` move behind an entry-point guard
  (`import.meta.url === pathToFileURL(process.argv[1]).href`) — the pattern
  already used in `scripts/bench-replay.mjs`. Both set exit codes, and neither
  belongs in an importer's process. Without the guard a bare `import` runs
  `timing`, the mode the file's own header tells reviewers to avoid because it
  takes tens of minutes. Verified: importing now takes milliseconds, prints
  nothing, exits 0.

**`packages/policy/test/redos-probe-parity.test.ts`**
- Imports both tables and the shipped `REDACTION_PATTERNS` + `OBSERVED_PATTERNS`
  (union — `email` lives in the second table and is in `AFTER`).
- Per row: the name must be a shipped detector name, and `.source` and `.flags`
  must match byte for byte. A probe row naming a detector that no longer exists
  is drift too — it means a rename landed in production and not here.
- Vitest compiles the TS source directly, so there is no build step and no
  staleness hole.

## 4. Non-vacuity

Both tables come from another module. If an export were renamed or dropped,
`Object.entries` would yield nothing, every `it.each` row would silently vanish,
and the suite would stay green while checking nothing — the same trap a seed
that matches nothing sets, which is the trap the probe already guards against.

Three guards, all mutation-verified:

- row counts asserted at or above the current 7 / 21 / 28;
- the module's export list asserted to be exactly `["AFTER", "NEW_DETECTORS"]`,
  which also catches the historical tables being exported by accident;
- `?? {}` when reading each table, so a dropped export fails the count
  assertion with a message naming the problem instead of crashing module load
  with a bare `Cannot convert undefined or null to object`.

## 5. Scope: truthfulness, not coverage

This catches a probe row that **lies** about what ships. It does not require
the probe to **cover** every shipped detector. 28 of 41 rows are probed; the 13
without a seed are `jwt`, `github_token`, `anthropic_key`, `openai_key`,
`aws_access_key`, `bearer_token`, `env_value`, `url_query_secret`,
`cli_secret_flag_eq`, `cli_secret_flag_spaced`, `credit_card`, `iban`,
`tr_national_id`.

A new detector added with no probe row is therefore still unmeasured. Forcing
coverage would mean inventing 13 adversarial seeds now, several for detectors
(`credit_card`, `iban`, `tr_national_id`) whose cost profile nobody has
questioned. Left open deliberately.

## 6. Dead allowlist entries — RESOLVED 2026-07-26

`MATCH_FREE_BY_DESIGN` had 17 entries, of which **3** were not `NEW_DETECTORS`
keys: `private_key_block (PKCS#8 run)`, `private_key_block (PGP run)` and
`private_key_block (PGP SECRET)`. `assertSeedsMatch()` only iterates
`NEW_DETECTORS`, so those three exempted nothing while looking like coverage.
Recorded here as "filed rather than folded in"; folded in instead.

**The fix is not "extend the guard to those seeds."** Measured all ten seeds in
`SEEDS` and `EXTRA_PK_SEEDS` against their patterns at 64 KB: **all ten produce
zero matches**, and correctly so. They are worst-case *scan* seeds —
`" ".repeat(n)`, `postgres://a` + n colons, `-----BEGIN A PRIVATE KEY-----`
with no END — where matching nothing is the intended behaviour and the cost
being measured is the engine failing at every position. A match-count guard
over them would exempt 10 of 10 and prove nothing: a guard in name only.

So the guard's scope is now stated explicitly in the source, the three dead
entries are gone, and a test makes the class unrepeatable: every exemption must
name a key the guard actually iterates. Mutation-verified three ways —
re-adding a dead entry (`expected ['private_key_block (PGP run)'] to deeply
equal []`), emptying the allowlist, and dropping its export.

What remains genuinely unchecked is whether a scan seed still contains its
anchor — if someone edits `db_url`'s seed and breaks `postgres://`, it still
measures *something*, just not the thing the row claims. That needs an
anchor-containment check rather than a match count, and is not built here.
