# Security review (design) — persistent proxy routing + saver inheritance, round-2 text

- **Reviewer:** independent security-reviewer (fresh context; not the spec author)
- **Date:** 2026-07-02
- **Gate:** CRITICAL design gate, round-2 re-run required by spec frontmatter (`design_reviews_pending_rerun: security-reviewer`)
- **Documents reviewed:**
  - `docs/superpowers/specs/2026-07-02-persistent-proxy-routing-design.md` (full, 972 lines; cited as P:<line>)
  - `docs/superpowers/specs/2026-07-02-saver-activation-inheritance-design.md` (security-relevant sections: identity, storage hardening, heartbeat, locks; cited as S:<line>)

## Scope

Round-2 amended text only (manual legacy-service migration, stateless plist ops, start-token/boot-id/fence owner identity with durable handoff deadlines). Surfaces:

1. Credential and API-path exposure (proxy forwarding, upstream pinning, custom upstream, redirects).
2. Claude settings-file mutation safety (route apply/remove, hooks, locking, symlinks, atomicity).
3. Loopback service authentication: supervisor control API, ownership health HMAC, GUI bridge capability, GUI session/launch capabilities.
4. LaunchAgent/plist injection and lifecycle surface (install, legacy replacement, uninstall, kickstart/bootstrap discipline).
5. Lock and state-file TOCTOU (transition/supervisor/recovery/settings/activation/heartbeat locks; state and usage files).
6. Privacy of persisted telemetry (usage events, heartbeat registry, error/status contents).
7. Fail-closed behavior on every conflict path (foreign route, invalid settings, legacy service, live transition, reconcile blocks, drain/shutdown guards).

Out of scope: implementation code (none exists yet — this is the design gate), non-security spec quality, the saver spec's non-security precedence semantics.

## Method

Adversarial: for each surface, a concrete attack or abuse scenario was constructed and checked against the spec text; the spec passes a surface only if its text blocks the scenario or explicitly documents the residual. Attacks attempted:

| # | Surface | Attack attempted | Result |
| --- | --- | --- | --- |
| A1 | Credential path | Local attacker pre-binds 127.0.0.1:8787 before enable to receive routed credentials | Blocked: enable fails `port_unavailable` with no route write (P879); health-check adoption requires HMAC proof the attacker cannot produce (P437-448, P883-884). |
| A2 | Credential path | Attacker listener passes ownership health by replaying or relaying proofs | Blocked: fresh 256-bit challenge per probe, capability never transmitted, constant-time verification, instance-id binding (P437-448); relay needs the genuine listener on another port, which persistent mode forbids (P128). |
| A3 | Credential path | Redirect upstream responses to attacker origin with auth attached; smuggle credentials via upstream URL | Blocked: default origin pinned, custom upstream requires `--upstream` + `--confirm-credential-forwarding`, userinfo/path/query/fragment rejected, cross-origin redirects with auth refused, custom origin permanently marked in status (P752-758, P857). |
| A4 | Credential path | Bind the freed fixed port after supervisor SIGKILL and intercept in-memory-routed running clients | Partially residual — see Finding 1. Route removal on failed rebind protects future launches only (P524-525, P529-532, P601-604). |
| A5 | Settings mutation | Pre-plant exact MegaSaver URL (no lease) so cleanup/disable deletes or shuts down over it | Blocked: exact-without-lease is never cleaned, blocks listener shutdown, adoption requires explicit enable + nonce health (P665-666, P584-586, matrix rows P624, P629, P632). |
| A6 | Settings mutation | Symlinked settings/lock path or swapped file between check and write | Blocked: symlink refusal at leaf, lstat-open-fstat identity, atomic rename, fsync, mode preservation, shared cross-process settings lock with process-start-token identity (P645-662, P858-860). |
| A7 | Settings mutation | Corrupt/malformed settings induce destructive rewrite | Blocked: `settings_invalid` fail-closed, file untouched, lease/transition retained, listener kept alive (P667, P581-583, P882). |
| A8 | Control API | Browser/local-process CSRF or direct call to supervisor control API | Blocked: random port + ≥256-bit token in mode-0600 runtime file, constant-time compare, fixed method/path allowlist, strict bodies, size limit, token never in browser status or logs (P837-851). |
| A9 | GUI | Malicious local webpage or DNS-rebinding page mutates proxy state | Blocked: bridge capability never reaches browser; one-time 120-s single-use launch capability exchanged for HttpOnly SameSite=Strict session cookie; CSRF tokens; literal 127.0.0.1 binds; Host + exact Origin validation; missing/foreign Origin, expired session, invalid CSRF, oversized body, unknown fields all hard-rejected; dev mode fail-closed (P812-834, P843-846). Read-surface auth unspecified — see Finding 4. |
| A10 | Plist | Inject argv/label/env or path payload into generated plist; hijack backup/restore | Blocked: structured serializer, fixed label and argv array, absolute-path validation, no shell/interpolation, no user-controlled env keys (P852-854); backups confined to store migration-backup dir with digest verification before restore or idempotent success (P293-296, P707-709). |
| A11 | Plist | Trick MegaSaver into killing or replacing a foreign/legacy service | Blocked (round-2): MegaSaver never stops a process it did not start; loaded legacy job fails `legacy_service_present` with manual `launchctl bootout` instruction; unknown label/argv refuses overwrite; `kickstart` never `-k`; uninstall is stateless, observation-converged, and blocks on any digest mismatch (P688-720, P875-877). |
| A12 | Locks/TOCTOU | PID-reuse veto, stale-owner immortality, quarantine race dual-mutation, resumed suspended owner mutation | Largely blocked by round-2 identity: start-token/boot-id/fence, wx-create + held-descriptor in-place lease refresh, inode identity, fenced revalidation before every mutation, durable `handoffDeadline` (bounded 60 s) decoupled from the released filesystem lock, alternative (not AND) staleness predicates, single-slot transition never silently overwritten (P302-375). One overstated claim — see Finding 3. |
| A13 | State files | Swap/symlink control/runtime/usage files; smuggle content through model field | Blocked: 0700 dir / 0600 files, atomic write + fsync, symlink rejection, strict versioned schemas, lstat-open-fstat + no-follow on usage files, model identifier regex-sanitized and only for default-origin successes, custom-upstream model strings never persisted or hashed (P283-287, P858-871). |
| A14 | Telemetry privacy | Extract prompts/keys/URLs/paths from persisted events, errors, or status | Blocked: events are counts/timestamps/model-category only; errors are enumerated codes plus bounded safe-detail enums; status never echoes foreign routes, paths, capabilities, or thrown text; rotation bounded 4 files / 256 MiB / 90 days (P855-871, P761-786). Heartbeat registry is metadata-only, 0600, bounded 256 keys / 30 days, and its pseudonymity (FNV workspace key) is explicitly acknowledged (S211-214, S310-316, S431-432). |
| A15 | Saver identity | Malicious cloned repository crafts `.git` metadata to hijack or join a family, or to force pathological reads | Parsing is tightly bounded (4 KiB, UTF-8, no NUL, single-line, 32 ancestors / 40 metadata ops, leaf-symlink refusal, no Git subprocess: S96-125, S364-368) and reciprocal pointers bind linked worktrees (S121-125). The no-`commondir` branch skips the back-pointer — see Finding 2. |
| A16 | Saver storage/locks | Symlink/hardlink/owner attacks on activation records; lock starvation of the hook; clock manipulation of heartbeats | Blocked: lstat-open-fstat, owner-only parents, regular-file leaves, fail-closed per precedence level, 0700/0600, boot-id/start-token/fence activation lock with pre-mutation revalidation and post-lock re-read; heartbeat lock is 10 ms non-blocking and skipped on contention; strict-newer compare, `clock_regression` no-op, 5-minute `future_skew` rejection, prune-on-write retention (S243-260, S317-331). |
| A17 | Fail-closed sweep | Every enumerated conflict path checked for a branch that mutates or silently proceeds | Pass: foreign route, invalid settings, legacy service, live transition, `reconcileBlocked`, exact-unleased pre-shutdown re-check, bootstrap failure (`desiredEnabled=false` + `autostart_failed`), SIGTERM non-action, dead-owner observe-only monitor — all fail closed with an explicit recovery escape and no unrecoverable retained state (P402-412, P457-499, P534-562, P564-607, P609-643, P875-890). |

## Findings

**MINOR-1 — Port-hijack credential interception of in-memory-routed clients is a residual the Security invariants never name.**
P529-532 documents the SIGKILL stale-route window and P601-604 admits unroute cannot purge the base URL from already-running clients, but both are framed as routing/availability residuals. Concretely: after forced supervisor death, unprivileged fixed port 8787 (P128) is bindable by any other local user; running Claude clients keep sending auth headers to whatever listens there, and leased-route removal on failed rebind (P524-525) protects only future launches. Every practically available control is already specified (fail-closed enable P879, LaunchAgent nonzero-retry restart P530-531, route removal); the gap is acknowledgment. Required action: add one sentence to Security invariants / residual documentation naming local credential interception on shared machines as the consequence of this window. No design change is demanded.

**MINOR-2 — Family-identity adoption via the no-`commondir` gitdir branch (saver spec).**
S101-108 accepts a `.git` file whose `gitdir:` target lacks `commondir` as its own common directory with only structural checks (S121-124), while reciprocal back-pointer validation applies only to linked worktrees. A hostile cloned repository can point `gitdir:` at a victim repository's main `.git` directory and resolve to the victim's family key, inheriting its saver activation and writing an attacker-influenced `identityPath` into the victim's store (S155-158). Impact is bounded to activation inheritance of evidence-preserving compression — no credential, settings, or route exposure — and running an agent inside a hostile repo already implies larger risks. Required action: acknowledge as a documented limitation or add a binding rule for the no-`commondir` case; add a hostile-repo fixture to the test table either way.

**NOTE-3 — "Never dual mutation" (P369-372) overstates advisory-lock guarantees.**
Fenced revalidation is "immediately before" each mutation (P337-339), but validation and the mutation syscall are not atomic, and the protected resources (settings file, launchctl) do not enforce fence tokens. An owner suspended between a passing validation and its write, displaced by a contender that legitimately observed an expired lease, can land one stale operation. Consequences are bounded by value guards and read-back verification; threat is same-user. Reword to a bounded one-operation residual, matching the spec's own "documented rather than claimed away" standard (P532).

**NOTE-4 — GUI read-surface authentication unspecified.**
P820-829 gates only mutation requests behind the session/CSRF bootstrap. Status reads on the 127.0.0.1 frontend appear reachable with only Origin/Host defense-in-depth (P813-814). Exposure is bounded (enumerated fields, no secrets/paths/foreign values per P761-786, P855-859), but the spec should state whether reads require the session or are intentionally enumerated-only-unauthenticated.

## Residual risks acknowledged by the spec

The spec already documents these honestly; they are accepted, not findings:

1. SIGKILL stale-route window until LaunchAgent restart removes the leased route (P529-532) — subject to MINOR-1's framing amendment.
2. No process-independent proof that old clients discarded the base URL; drain + explicit `--confirm-clients-restarted` is the mitigation, forced termination excluded (P601-607, P888-890).
3. OS forced termination, failed health, and unexpected close cannot honor drain (P560-562).
4. Local users can query the health endpoint (contents non-sensitive; proof unforgeable) (P445-447).
5. Heartbeat `workspaceKey` is pseudonymous (dictionary-checkable FNV of a path), not anonymous (S310-313).
6. Canonical-path family identity: a different repository at the same canonical path inherits activation by documented design (S136-141, S420-422); bind-mount/network aliases remain distinct (S158-159).
7. `case_mode_unknown` accepts visible false-negative alias splits rather than conflation (S146-147).
8. Claude Desktop support remains `unverified`; usage telemetry never attributes it (P789-794, P971-972).
9. Non-macOS cross-reboot autostart reported `unsupported` — no false platform claim (P722-724).

## Verdict

**APPROVE_WITH_NOTES.**

No BLOCKING or MAJOR security findings against the round-2 text. The round-2 amendments materially close the previously risky surfaces: manual-only legacy migration eliminates the foreign-process kill window and the migration journal; stateless observation-converged plist operations remove journal-tamper and crash-cut ambiguity; start-token/boot-id/fence identity with the durable `handoffDeadline` removes PID-reuse vetoes and immortal released-lock owners. Fail-closed behavior held under adversarial checking on every conflict path examined, with an explicit recovery escape for each retained state.

Two MINOR findings (residual-risk naming for fixed-port credential interception; no-`commondir` family adoption by a hostile repo) and two NOTEs (advisory-lock wording; GUI read-surface auth statement) should be folded into the spec text or its test tables before the plan is written. None requires an architectural change; none blocks proceeding to `superpowers:writing-plans` once addressed.

Per the spec's governance requirement (P926-931), this artifact is to be archived under `docs/superpowers/reviews/` by the orchestrating session.

---

## Addendum (2026-07-03, post-review)

Every MINOR/NOTE finding above was incorporated into the spec text in the same
amendment session (monitor drift-rule scoping, lock-file exception in Security
invariants, port-hijack residual acknowledgment, no-commondir family keyed to
the worktree root, quarantine-race residual wording, authenticated status
reads, handoff-deadline stamp ordering, intent-persisted/desired-false matrix
row, lock_unverifiable/recovery_failed bindings, telemetry lastCompressionAt
scoping, familyIdentityDiagnostic in status). Verdict unchanged.
