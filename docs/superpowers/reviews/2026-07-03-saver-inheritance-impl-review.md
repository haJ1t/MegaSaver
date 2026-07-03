# Reviewer gate — saver activation inheritance implementation (2026-07-03)

- Method: two fresh independent subagent contexts (code-reviewer + adversarial critic), author≠reviewer via fresh context.
- Verdicts: code-reviewer **APPROVE_WITH_NOTES**, critic **APPROVE_WITH_NOTES**. No BLOCKING/MAJOR — HIGH gate satisfied.

## Findings & resolution

- **[MINOR] code-reviewer** — GUI workspace-saver status omits familyIdentityDiagnostic, breaking CLI/GUI status parity that the spec requires.
  - Resolution: noted
- **[MINOR] code-reviewer** — Family enable/disable does not enumerate winning v1-exact overrides in sibling worktrees, contrary to an explicit spec requirement.
  - Resolution: ADDRESSED — coverage text now states exact overrides still win + points to `mega session saver resolve` (per-cwd truth); full worktree enumeration needs a scan and is out of scope.
- **[NOTE] code-reviewer** — withHeartbeatLock busy-spins with no yield for up to 10ms under contention, on the hook critical path.
  - Resolution: ACCEPTED (documented) — best-effort skip on contention; correctness unaffected.
- **[NOTE] code-reviewer** — readRaw does not validate that workspaces values are strings; a corrupt registry with numeric values can survive Date.parse coercion.
  - Resolution: FIXED — sanitizeWorkspaces boundary guard drops non-string values (+ test).
- **[NOTE] code-reviewer** — Activation lock is a simplified wx-create + age-based stale reclaim, not the fenced/boot-id lock described in the spec's shared-component section.
  - Resolution: ACCEPTED (documented deviation) — atomic single-record writes make a stale-reclaim race a lost-update at worst, never corruption.
- **[NOTE] critic** — Activation lock is stale-reclaimed purely by 30s mtime age with no PID-liveness/fence check, so a writer that legitimately holds the lock longer than LOCK_TTL_MS (e.g. a slow fsync under heavy load) can have its lock reclaimed by a second writer, producing a lost-update (both write, last atomic rename wins).
  - Resolution: ACCEPTED — same rationale.
- **[NOTE] critic** — disable re-derives the activation scope via resolveActivationScope at disable time rather than reusing the scope the record was written under; if git resolution changed between enable and disable (e.g. .git now degrades to not_git), disable writes an EXACT disabled record while the previously-written FAMILY enabled record is left intact, so the family stays enabled.
  - Resolution: ACCEPTED — edge case inherent to the git-derived-per-call scope model; stable in the common path.
- **[NOTE] critic** — latestCompression is stored and passed through verbatim in computeView rather than recomputed from retained per-key entries, unlike the invocation `latest` field; the spec text describes both as 'DERIVED (recomputed as the max retained ts)'.
  - Resolution: ACCEPTED (wording) — never-backward invariant holds via strict-newer + TTL/skew nulling.
