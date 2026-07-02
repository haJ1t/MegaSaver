# Tracer evidence-loop (design) — persistent proxy routing, round-2 text

- **Target:** `docs/superpowers/specs/2026-07-02-persistent-proxy-routing-design.md` (worktree `persistent-proxy-routing`, round-2 amended text; read in full, lines cited below).
- **Method:** exhaustive enumeration of every legal persisted `ProxyTransition` (kind × phase, lines 202-228) plus the mandated crash cuts; for each, the applicable startup/recovery/monitor rules were traced and six convergence invariants checked.
- **Reviewer context:** independent tracer; no authorship of the spec in this context.

## Enumeration coverage

### Legal persisted transitions (11 total, from the discriminated union, lines 202-228)

| # | kind / phase | expectedUnrouted | Governing recovery text | Traced result |
|---|---|---|---|---|
| 1 | enable / intent_persisted | false | matrix row line 615; enable step 1 (457-465); universal escape 407-412 | Converges; ambiguity A1 when desiredEnabled still false (see below) |
| 2 | enable / bootstrap_pending | false | row 615; handoff rules 349-360, 391-399 | Resume bootstrap or expire via handoffDeadline; recoverable |
| 3 | enable / listener_healthy | false | row 616 | Dead listener ⇒ failed health ⇒ blocked failure, only owned listener stopped; no route exists yet |
| 4 | enable / lease_installing | false | rows 617-620; installing-lease determinism 419-429 | All four route observations (exact+healthy, exact+failed, absent, foreign) enumerated; every branch clears or advances |
| 5 | enable / route_verified | false | row 621 | Match ⇒ clear+ready; every mismatch ⇒ leased rollback |
| 6 | enable / rollback | false | rows 622-625 | Four observed-state branches; exact-unleased/invalid blocks for explicit recovery (ambiguity A2 on live-owner escape mechanics) |
| 7 | disable / unroute_expected | true | rows 626-629; disable steps 1-8 (566-596) | All route observations enumerated; 'never apply a route' explicit |
| 8 | disable / rollback | true | rows 630-632; step 3 (575-577) | Blocked states escapable via explicit stop/recover (A2 applies) |
| 9 | recover / route_safety | true | row 635; recovery identity 318-327, quarantine 363-375 | Leased exact route made safe first; foreign/unleased preserved |
| 10 | recover / owner_replacement | true | row 636 | Quarantine stale locks/runtime, resume from durable desired state |
| 11 | drain_complete / confirmation_persisted | true | rows 633-634 | Live generation ⇒ re-inspect then stop; dead/prior-boot ⇒ idempotent success, never rebind |

Line 642-643 pins the strict union: every kind/phase/expectedUnrouted combination outside these 11 is schema-rejected, with tests required for the rejection of the former cross-product.

### Crash cuts (SIGKILL)

**Enable step boundaries 1-11 (steps at lines 457-483):**

| Cut (after step) | Durable state at kill | Recovery traced | Invariants |
|---|---|---|---|
| E1 | enable/intent_persisted, desiredEnabled possibly false, no LaunchAgent | No auto-restart exists; escape = explicit start/--recover/stop (407-412); matrix row 615 | Holds; ambiguity A1 |
| E2 | bootstrap_pending, desiredEnabled=true, no deadline | Row 615 resume bootstrap; offline_cli owner stale via 30 s lease/process death (311-317) | Holds |
| E3 (= handoff cut, after deadline stamp + lock release, before supervisor acquire) | bootstrap_pending + unexpired handoffDeadline, lock released | Liveness from durable deadline only (192-199, 313-317); supervisor wx-acquires, validates id+deadline, rewrites owner under lock (349-353); expired deadline ⇒ stale ⇒ recovery (321-323, 358-360); contenders during window get transition_in_progress (355-358) | Holds; NOTE on 60 s stop refusal |
| E4 | bootstrap_pending, owner=supervisor, listener bound, dead | LaunchAgent restart (679-680); replacement recovery 379-385; row 615; no lease/route yet | Holds |
| E5 | listener_healthy | Row 616: failed health (listener died with process) ⇒ blocked failure; no route written | Holds |
| E6 | lease_installing (installing lease), route absent | Row 619: absent without matching health blocks; incomplete lease cleared with diagnostic (421-423) | Holds |
| E7 | lease_installing, route exact, listener dead | Row 618: remove leased exact route, clear lease, block, never report ready | Inv. 3 satisfied |
| E8 | same as E7 (verify not yet persisted as promotion) | Row 618 | Holds |
| E9 | route_verified (or cleared) + active lease | Row 621 mismatch ⇒ leased rollback; if transition already cleared: enabled reconcile rebinds/health-checks/verifies (521-522, 665); stale-route window is the documented residual with mandated restart (528-532) | Inv. 3 holds via defined recovery |
| E10 | transition cleared, hooks possibly unrepaired | hooksConfigured=false surfaced, no false all-green (884-886) | Holds |
| E11 | steady ready | Same as E9 steady-state reconcile | Holds |

Post-supervisor rollback rule (485-494) checked: removal only under this attempt's installing or prior active lease; healthy exposed listener becomes a drain, never stopped without confirmation; pre-existing exact unleased URL never removed.

**Disable step boundaries 1-8 (steps at lines 566-596):**

| Cut | Durable state | Recovery traced | Invariants |
|---|---|---|---|
| D1 | unroute_expected + desiredEnabled=false persisted, route exact+leased | Row 626: resume value-guarded removal; never apply a route; expectedUnrouted suppresses drift classification (553-554) | Inv. 2, 6 hold |
| D2 | route removed, lease retained | Rows 627-628; post-SIGKILL generation dead ⇒ clear lease/transition, disabled success, no drain/rebind | Holds |
| D3 (failure branch) | disable/rollback retained | Rows 630-632; explicit stop/recover escape (A2 mechanics) | Inv. 4 holds per 411-412 |
| D4 | absent/foreign/exact-unleased/invalid handling persisted | Rows 627-629; exact-unleased and invalid block with enumerated errors, listener preserved | Holds |
| D5 | pre-shutdown re-read done, lease present | Same durable shape as D2; rows 626-628 | Holds |
| D6 | lease cleared, drain recorded, transition cleared | Startup drain-expiry rule 507-510: dead-instance drain marked drain_expired, cleared, no rebind | Inv. 5 holds |
| D7 | draining, forwarding | SIGKILL ⇒ restart ⇒ drain expiry, no rebind; stranded old clients are the documented residual (601-603, 559-562) | Holds |
| D8 | drain_complete/confirmation_persisted (before/after stop) | Rows 633-634: live ⇒ re-inspect then stop; dead ⇒ verify route absent/foreign, clear, idempotent success, never rebind | Holds |

**Recovery quarantine cut (between rename and verify, lines 363-375):** renamed lock at `recovery.lock.stale.<random-id>`, contender dead. Next contender wx-creates a fresh lock after ENOENT; a displaced live owner self-aborts at its next fenced validation (336-340); route safety precedes replacement; 'the race costs one aborted owner, never dual mutation' (373-374). Converges; only cosmetic stale files remain.

**Legacy plist replacement cut (between the two renames, lines 697-702):** journal-free convergence by observation — legacy gone + backup present + managed absent ⇒ install; digest mismatch or extra file ⇒ refuse without mutation. Backup confined to the migration-backup directory with digest verification (291-296). Retained bootstrap transition is dead/expired ⇒ explicit retry/--recover re-runs the observation. Foreign plists never touched (688-696, 959). Converges.

## Invariants checked

1. **Foreign `ANTHROPIC_BASE_URL` never overwritten/removed — HOLDS on every path.** Enable preflight fails on foreign without mutation (462-464); every matrix row with a foreign observation preserves it (620, 623, 627-628, 631, 635); startup drift path preserves foreign and blocks (515-520, 542-546); recovery 'preserves absent, foreign, or unleased values' (374-375, 405-406); cleanup requires lease + exact value (415-417, 666-668); locked decisions 5-6 (118-121).
2. **No route applied during any disable-direction state — HOLDS.** All expectedUnrouted transitions (disable, recover, drain_complete) have rows that never apply (626-636); 'absent route resumes apply only for the authenticated pending enable transition' (427-428); monitor suspended for live transitions and observe-only for retained dead-owner ones (538-541); reconcileBlocked path 'never write a route' (511-520); startup handles every non-null transition before normal reconcile (611).
3. **Owned route never points at a dead listener without defined removing recovery — HOLDS with documented bounded residual.** Lease_installing failed-health removal (618); route_verified mismatch rollback (621); live-supervisor runtime failure unroutes before close (527-528); locked decision 7 (122-124); unhealthy-listener startup removal covers post-reboot foreign port capture (524-525); SIGKILL window closed by mandated LaunchAgent nonzero-retry restart and replacement recovery that never exits success while a leased route may point at a dead listener (528-532, 379-385).
4. **Every retained state has an explicit escape — HOLDS by explicit assertion (411-412), with ambiguity A2 on the live-owner mechanics.** Universal --recover escape for dead/expired owners including blocked rollback states (402-412); blocked rows defer to explicit stop/recover (624, 629-632); recovery matrix leaves no unenumerated branch (639-641).
5. **Drains never killed by a later start and expire after reboot/instance death — HOLDS.** Later start reactivates without rebinding and 'never signals a live drain' (605-607); plain kickstart only when identity proves no live supervisor, never `kickstart -k` (683-687); drain expiry on prior boot/dead identity with no rebind (507-510, 634); drainingGeneration carries instanceId/processStartToken/bootId (241-247); test pin 'active drain is never kickstarted/killed' (902).
6. **Disable intent never silently reversed — HOLDS.** Desired state changes only via explicit action (111-113, 431-434); 'No recovery branch converts disabled intent into enable' (641-642); SIGINT/SIGTERM mutates nothing (556-558); recover/owner_replacement resumes from durable desired state (636). The only tension is ambiguity A1's literal matrix reading, which the global rule at 641-642 overrides in the safe direction.

## Failures/ambiguities

No invariant failure was found on any enumerated transition or crash cut. Two textual ambiguities and two accepted-residual notes:

**A1 (MINOR) — enable/intent_persisted with desiredEnabled=false (cut E1).** Step 1 (457-465) persists the enable transition before step 2 (466-467) persists `desiredEnabled=true`. For a SIGKILL in that window, matrix row 615 mandates 'resume bootstrap' unconditionally, while 641-642 forbids recovery converting disabled intent into enable and row 636 resumes from durable desired state. If entered via `proxy stop` ('dead/expired one goes through recovery first', 568-570), the literal row would transiently enable and install a LaunchAgent during a disable. The governing sentence at 641-642 resolves this safely, but the row should be qualified: resume only when `desiredEnabled=true` or when invoked by start/--recover; otherwise clear the transition.

**A2 (MINOR) — live-owner parked rollback escape mechanics.** Lines 355-358 return `transition_in_progress` for any live persisted transition; blocked rows (624, 630, 632) park a transition under a live supervisor and require 'explicit stop/recover', but --recover never breaks a healthy authenticated owner (410-411). The intended reading — the live supervisor's own control API resumes its parked transition on an explicit request, with 355-358 scoped to lock contenders adopting or overwriting a foreign in-flight transition — is consistent with 411-412 and 575-577 but never stated. One clarifying sentence closes it.

**N1 (NOTE) — 60 s handoff refusal window.** During an unexpired handoffDeadline (468-470), explicit stop returns `transition_in_progress` (355-358). Disable is delayed up to 60 s, never reversed. Carry into CLI/GUI error copy.

**N2 (NOTE) — honest residuals.** The SIGKILL stale-route window (528-532) and drain's inability to protect clients across forced termination (559-562) are documented, bounded, and each carries a defined removing/expiring recovery — this is the correct posture for a CRITICAL spec.

## Verdict

**APPROVE_WITH_NOTES.** All six convergence invariants hold on all 11 legal persisted transitions and all enumerated crash cuts (11 enable boundaries, 8 disable boundaries, handoff, recovery-quarantine rename/verify, legacy plist double-rename) under the spec's own governing rules. Two MINOR textual ambiguities (A1, A2) each admit exactly one safe reading already mandated elsewhere in the spec text; they should be closed with one-line clarifications during plan writing, but neither produces an invariant-violating behavior under the governing sentences (641-642 and 411-412). No unenumerated retained state, no path applies a route in a disable-direction state, no foreign value is ever mutated, and every dead-route/drain scenario has a defined removal or expiry.

Archive location per spec governance (lines 927-931): `docs/superpowers/reviews/`.

---

## Addendum (2026-07-03, post-review)

Every MINOR/NOTE finding above was incorporated into the spec text in the same
amendment session (monitor drift-rule scoping, lock-file exception in Security
invariants, port-hijack residual acknowledgment, no-commondir family keyed to
the worktree root, quarantine-race residual wording, authenticated status
reads, handoff-deadline stamp ordering, intent-persisted/desired-false matrix
row, lock_unverifiable/recovery_failed bindings, telemetry lastCompressionAt
scoping, familyIdentityDiagnostic in status). Verdict unchanged.
