# Counter-review — round-2 amendments + round-3 resolution

- **Method:** fresh independent Claude subagent contexts (no memory of authoring),
  standing in for Codex, which was unavailable (out of credits). This satisfies
  the author≠reviewer rule's substance (fresh context) but NOT its preferred
  independent-model-line form; recorded honestly here.
- **Author of round-2 + round-3 amendments:** Claude Code (main context).
- **Reviewers:** fresh subagents across four lenses per round.

## Round-2 counter-review (of commit 1d704265 — the migration-cut + dev:ino-flip amendments)

Three fresh adversarial lenses (proxy critic, saver critic, plan-readiness)
returned **REVISE**: 2 BLOCKING + 8 MAJOR + 5 MINOR + 2 NOTE.

- **BLOCKING (saver):** the round-2 "no-commondir → worktree root" change (added to
  defend against a hostile `.git` pointer) broke separate-git-dir: a main checkout
  and its linked worktree resolved to DIFFERENT family keys. Verified against real
  git by the reviewer. → **This is the value of a fresh review: the author's own
  round-2 fix introduced a correctness regression.**
- **BLOCKING (cross-spec):** proxy `lastCompressionAt` had no global data source; the
  saver spec produced no global compression artifact.
- **MAJOR ×8:** bootstrap-failure vs recovery-matrix desiredEnabled contradiction;
  `recover` transition kind vs single-slot invariant; saver precedence not executable
  top-down; invalid `.git` dropped a v1 exact override; no way to write a family record
  from a worktree; exact raw-key vs family canonical-key mismatch; abbreviated heartbeat
  schema; null-degradation depending on the missing compression artifact.

## Round-3 resolution (commit — this branch)

All 17 findings amended:

- separate-git-dir: reverted to keying by the resolved gitdir (= common dir) so main
  and worktrees converge; added `foreign_worktree_admin` rejection + documented the
  hostile standalone pointer as a bounded low-severity limitation (activation-state
  inheritance only, no credential/route/data exposure).
- global compression source: heartbeat registry gains `latestCompression`, derived
  under the heartbeat lock; proxy reader consumes it; schemas match byte-for-byte.
- bootstrap discriminant; `recover` kind deleted (recovery operates in place on the
  single slot); precedence rewritten to executable steps 0-4; v1-exact survives corrupt
  `.git`; family write from a worktree; exact raw-key documented; full heartbeat schema;
  four-field null degradation; `route_removed` dead code removed; `ProxySafeErrorDetail`
  mapped to producing paths; `ensureHooks` bounded enum; `RepositoryFamilyKey` validator;
  telemetry reader placed in the stats/CLI layer.

## Round-3 verification

Fresh lenses: **fix-verify APPROVE** (all 17 verified-fixed), **plan-readiness APPROVE**
(both specs plan-ready), **fresh-eyes REVISE** — one residual contradiction: the
precedence steps and Failure-handling disagreed on the `degraded git + no legacy record`
case. Fixed (both now route to the global default; legacy-present still fails closed to
disabled). A fourth fresh agent confirmed **CONSISTENT** across precedence, write-policy,
status, and acceptance, with no new contradiction and no unreachable/dual-outcome branch.

## Effect on the archived security + tracer design passes

The round-3 deltas are consistency/simplification fixes (state-machine surface removed,
error surface cleaned, saver identity/precedence corrected). None touches the credential
path, control/health/GUI auth, plist injection, or TOCTOU surfaces; `foreign_worktree_admin`
is a net security improvement, and `recover`-kind removal simplifies the traced state
machine without weakening any invariant (foreign route untouched, no route during disable,
every retained state escapable, drains not killed, disable intent not reversed). The
`2026-07-02-*-security-design-review.md` and `-tracer-design-evidence-loop.md`
APPROVE_WITH_NOTES conclusions therefore stand for the round-3 text.

## Verdict

**APPROVE.** Both specs are plan-ready. Remaining process caveat: an independent
non-Claude review line (Codex) never ran; if one becomes available before merge it should
re-bless the final text. Implementation proceeds in fixed order: saver inheritance (HIGH)
first, persistent routing (CRITICAL) second.
