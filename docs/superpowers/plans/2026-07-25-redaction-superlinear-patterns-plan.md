# Seven Super-Linear Redaction Patterns — Plan

Spec: [2026-07-25-redaction-superlinear-patterns-design.md](../specs/2026-07-25-redaction-superlinear-patterns-design.md)

Risk: **CRITICAL** (three §5a lock-table rows). Worktree
`claude/hungry-yonath-a2a359`. TDD throughout: no pattern edit lands before its
assertion is shown red.

> **Executed, then revised after review.** Steps 1-8 ran as written. Four
> reviewers then returned two security blockers and a set of false statements in
> the shipped comments, so Step 9 was added. Where the plan and what shipped
> diverge, the notes below say so rather than being quietly rewritten.

---

## Step 1 — Red: structural + growth-ratio harness

Add `packages/policy/test/redact-superlinear.test.ts` with, for each of the
seven patterns: the §6.1 structural gate, the `.flags` assertion, and the §6.3
growth-ratio timing driven by that pattern's own seed from spec §1c.

- **Verify:** `pnpm --filter @megasaver/policy test redact-superlinear` fails.
  Every structural gate must fail (no guard/bound in source yet) and every
  growth ratio must exceed 2.5×. Capture the output — this is the red proof
  that each assertion is load-bearing.

## Step 2 — Red: seeded equivalence corpus

Add the spec §6.2 positives, disclosed-loss negatives, and the §6.4 non-vacuity
gate (assert a minimum match count before asserting divergence counts).

**Shipped differently:** this went into the single
`redact-superlinear.test.ts` rather than a second
`redact-superlinear-equivalence.test.ts` file. The seeded differential corpus
itself lives in `scripts/redos-probe.mjs` (committed in Step 9) rather than in
the suite, because its runtime is minutes, not seconds.

- **Verify:** the positives pass against the *current* patterns (they are
  today's behaviour), the disclosed-loss negatives fail (today those inputs
  still redact), and the non-vacuity gate passes. A negative that passes now
  means the case is not actually a loss — investigate before continuing.

## Step 3 — Green: the three lookahead guards

Edit `packages/policy/src/redaction-patterns.ts` — prepend `(?=[A-Za-z0-9/+])`
to `aws_secret_key`, `(?=\S)` to `api_key_header`, `(?=[A-Za-z0-9+/=])` to
`basic_auth_header`. Add a WHY comment per pattern: the guard is semantically
inert, it exists for start-position pruning, it must stay *before* the
lookbehind, and the V8 left-to-right caveat (spec §3a).

- **Verify:** the three growth ratios drop under 2.5× and the three structural
  gates pass. Then the load-bearing check — **move one guard to after its
  lookbehind** and confirm the growth ratio goes red again while the
  equivalence corpus stays green. That proves the structural gate is the only
  thing fencing this edit.

## Step 4 — Green: the four bounds

Apply `{1,256}`/`{1,2048}` to `db_url`, `{1,2048}` to `url_basic_auth`,
`{1,32768}` to `private_key_block`, `{1,64}` to `email`'s local part. Leave
`db_url`'s trailing `\S+` and `private_key_block`'s `[A-Z ]+` alone — measured
non-drivers (spec §3b). Comment each bound with its value's justification and
its disclosed loss.

- **Verify:** all growth ratios under 2.5×; every §6.2 positive still redacts
  (especially the JWT-as-password and 19 KB PEM cases); the disclosed-loss
  negatives now pass.

## Step 5 — Amend the §5a lock table

In `docs/superpowers/specs/2026-05-10-bb3-policy-design.md` §5a, amend the
`aws_secret_key`, `db_url` and `private_key_block` rows with new bytes and a
footnote each (measured reason + disclosed loss). Same commit as steps 3–4.

- **Verify:** the three table rows transcribe byte-for-byte to the compiled
  `RegExp.source`. Pin the three `.source` strings in the test file so an edit
  cannot land without touching the assertion that names §5a. (Parsing the
  markdown table from a unit test was considered and dropped — it would couple
  `@megasaver/policy` to a docs path for no extra guarantee.)

## Step 6 — Full verification

- **Verify:** `pnpm verify` green (biome, tsc, vitest, conventions:check).
  Plus the reproduction evidence: before/after table at 100/200/400 KB per
  pattern, and the benign-log timing showing no regression on real input.

## Step 7 — Review chain

`security-reviewer` and `critic` in parallel (independent contexts, neither
the author), then `code-reviewer`. Feed each the spec's disclosed-loss table
and ask specifically whether any bound is set below a realistic secret length.

## Step 8 — Wiki + changeset

`wiki/concepts/unbounded-run-redos.md`: instances 4 and 5 → fixed; add the
three newly-filed patterns; record the "seeded corpus or the fuzz is vacuous"
lesson from spec §4. Timestamped entry in `wiki/log.md`. Changeset: **minor**.

---

## Step 9 — Review remediation (added after the review chain ran)

Four reviewers, none the author: `security-reviewer` (APPROVE_WITH_FIXES, 2
blockers), `critic` (NEEDS WORK, 6 defects), `code-reviewer`
(approve-with-changes, 5 must-fix), `verifier` (not sufficient to merge).

1. **Blocker — password bounds below a real credential.** Raise `db_url` and
   `url_basic_auth` to `{1,8192}`. → verify: a 2.5 KB opaque JWE-shaped token
   and an 8192-char password redact; 8193 does not. Fixtures must be OPAQUE, not
   a JWS, or `jwt` masks the result.
2. **Blocker — ledger containment.** Add `LEDGER_USERINFO` and a cliff-free
   `LEDGER_LONG_TOKEN` floor to `redactForLedger`. → verify: 0 password
   characters persist at lengths 100–40,000; ordinary paths untouched; both
   passes linear.
3. **`redact.ts` was unfenced.** Add public-surface tests. → verify: a 200 KB
   size gate in `redactWithFindings` now fails exactly one test (it previously
   passed all 259).
4. **Three mutant survivors.** Add `x-api-key : v`,
   `Authorization : Basic dXNlcjpw`, `svn+ssh://u:pw@host`. → verify: each
   corresponding mutant fails exactly one test.
5. **False statements in shipped comments and the §5a footnote.** The
   `private_key_block` bound-size claim (reverses at the cap), the
   `postgres://:pw@host` witness (not a loss), and the `email` guard direction
   (inverted). → verify: each corrected claim reproduces from
   `scripts/redos-probe.mjs`.
6. **Unreproducible numbers.** Commit `scripts/redos-probe.mjs` and requote every
   figure from one run of it. Withdraw the 14,274 figure the harness cannot
   reproduce; correct 8,862 → 13,333 and 30,002 → 23,334. → verify: no figure in
   the spec, changeset, source comments or wiki lacks a harness mode that
   regenerates it.
7. **Record fixes.** §5a byte-exactness and markdown escaping; six → seven;
   spec §6.2/§6.3 reconciled with the shipped instrument split; stale evidence
   counts (43 tests → 68).
8. **Filed separately:** the pre-existing PKCS#8/PGP coverage gap, asserted in
   the suite as a `KNOWN GAP` so it is visible rather than concealed.

- **Verify (all of Step 9):** `pnpm verify` green; `@megasaver/policy` suite
  green; the four previously-surviving mutants each kill exactly one test; both
  blocker repros closed end-to-end through `redact*()`.

---

## Step 10 — Private-key coverage (round 2)

Triggered by the security review of Step 9: `private_key_block` could not spell
several real headers.

1. **Label grouping.** `[A-Z ]*` → `(?:[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)* )*`.
   → verify: coverage of OpenSSL's own PEM table goes 7/32 → 32/32
   (`node scripts/redos-probe.mjs labels`); a permissive character class is
   measured and rejected (unbounded is ×7.13, bounded {0,64} is 4× slower);
   seven `(X+)*` attack shapes stay ×1.81–2.04.
2. **`PGP SECRET KEY BLOCK`.** GnuPG's armour table has three key-block headers,
   not two. → verify: `strings $(which gpg) | grep 'KEY BLOCK'`.
3. **Four non-PEM detectors**: `ssh2_private_key_block`, `putty_private_key`,
   `age_secret_key`, `jwk_private_key`.
   → verify: each linear on a run of its own opening anchor with no terminator.

- **Verify (Step 10):** §5a amended; byte pins for every new detector; the four
  `A- / -A / A. / A--B` structural fixtures ported to every consumer of the
  grouped label.

## Step 11 — Credential carriers beyond key files (round 3)

Closes the leak list the Step 10 security review enumerated.

1. `aws_secret_key` gains the `i` flag — `AWS_SECRET_ACCESS_KEY=<40>` unquoted
   matched nothing. → verify: §5a amended; flags pin updated to `gi`.
2. Nine detectors: `aws_session_token`, `json_secret_field`, `netrc_password`,
   `npm_token`, `pypi_token`, `vault_token`, `ansible_vault`, `bip32_xprv`,
   `base64_pem_block`.
   → verify: all 12 previously-leaking carriers redact; 0 over-redaction across
   the negative corpus; each linear with a committed harness seed.
3. `base64_pem_block` must spell the LABEL in base64, not just `-----BEGIN `.
   → verify: 12 of 12 across six private and six non-private armour forms; a
   mutant truncating the prefix must fail (it survived the first attempt).

- **Verify (Step 11):** `pnpm verify` exit 0; 428/428; 15 mutants across the nine
  all killed; harness seeds committed for each.

## Step 12 — Re-review the shipped state, then land

The Step 10 chain reviewed a 24-detector tree; the tree now has 33. Every round
so far found a real defect in newly-added detectors, so the additions must not
merge unreviewed.

- **Verify:** architect + security-reviewer + critic + verifier, all against the
  33-detector state; findings fixed; then commit.

---

## Step 13 — Round-3 review remediation, and the commit-split decision

Four reviewers against the 33-entry state. Verdicts: architect APPROVE_WITH_FIXES
(2 blocking), security-reviewer APPROVE_WITH_FIXES (1 HIGH), critic NEEDS WORK
(8 defects, 6 record errors, 53-of-63 kills pin-only), verifier
sufficient-on-substance-but-not-as-presented.

Fixed: the `aws sts assume-role` credential set leaking whole (`ASIA` prefix +
two STS field names + a false STS comment); `github_pat_`; base64 `SECRET KEY`;
`ansible_vault` format 1.2; the `netrc` 128-ceiling leaving 72 chars cleartext;
netrc `default`/`account` records; the base64 tail eating the next YAML key; the
ledger scrub destroying credential-free URL hosts at 2,274 ms/100 KB; behavioural
bound-edge fixtures for all nine carriers; a table-wide non-vacuity gate; two
vacuous probe seeds and two unshipped probe patterns; and the 29/29 → 32/32,
33 → 32 record errors.

### The commit split — recommended, NOT done

All four reviewers recommended splitting. The architect's seam, recorded here so
it is not lost:

| # | commit | why separate |
|---|---|---|
| 1 | linear fixes (guards + bounds, §5a amendment) | the only commit that REDUCES coverage |
| 2 | PKCS#8/PGP/label-grouping + `i` flag | INCREASES coverage on locked rows; mixing with 1 makes the net effect unreviewable |
| 3 | ledger containment (`redact.ts`) | different file, different consumer, different invariant (F-FW-1) |
| 4 | non-PEM key detectors | must land BEFORE 5: `jwk_private_key` has to precede every prefix detector or JWK leakage rises |
| 5 | vendor/credential carriers | zero ordering interaction once 4 has landed |

**Not done, and the reason is honest rather than tactical:** the tests were
written against the final state throughout. A five-way split whose commits each
pass their own suite needs the work redone incrementally, not reconstructed from
this working tree — reconstruction would produce commits that never actually
passed. If the split is wanted, it should be a deliberate replay, and that is a
call for the branch owner.
