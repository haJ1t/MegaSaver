---
title: connector status critic followups (S1 + S2) — design
risk: MEDIUM
status: draft
created: 2026-05-09
updated: 2026-05-09
related:
  - docs/superpowers/specs/2026-05-09-mega-connector-status-design.md
  - docs/superpowers/specs/2026-05-09-mega-connector-sync-design.md
  - wiki/entities/cli.md
  - wiki/index.md
---

# connector status critic followups (S1 + S2) — design

## §0 TL;DR

Close two of the twelve critic findings filed against PR #15
(`mega connector status`). Single CLI-only slot, no schema or
shared-package change.

- **S1** Switch `pickLatestOpenSession`'s ranking from lexicographic
  string compare on `Session.startedAt` to a numeric
  `Date.parse`-based compare. The same predicate is used by both
  `runConnectorSync` and `runConnectorStatus`; one fix protects
  both call sites.
- **S2** Add the `session=<id|none>` suffix to the `error` status
  line emitted by `runConnectorStatus`, restoring column symmetry
  across all five status words. Sync output is left unchanged.

The change in S2 also closes **S12** (per-target session compute
deduplication) for free, because computing the session label once
per target — outside the per-target try/catch — is exactly what
makes the suffix available to the error path.

## §1 Motivation

The critic pass on PR #15 returned APPROVED_WITH_FOLLOWUPS with
two MAJOR findings (S1, S2) and ten further v0.2 items
(S3–S11, plus S12 cosmetic). S1 is the only finding flagged as a
silent-correctness risk: today the bug is masked because the only
writer of `Session.startedAt` is `Date#toISOString()`, which always
emits a `Z`-suffixed timestamp. The Zod schema, however, accepts
any RFC 3339 timestamp with or without a fixed offset
(`z.string().datetime({ offset: true })`), and any future writer
or hand-edited `sessions.json` can introduce a non-`Z` offset that
would break the lexicographic compare. The CI-gate use case for
`mega connector status` (silently incorrect `session=<id>` output)
is the realistic failure mode.

S2 is a UX papercut, not a correctness bug, but the asymmetric
column count between `error` (3 columns) and the other four
statuses (4 columns) is a parser footgun for the same CI-gate use
case. The fix is one line; we close it now to harden the contract
before `--json` lands.

## §2 Non-goals

- No schema change to `Session.startedAt`. The Zod regex tightening
  was considered (Q1-A) and rejected: today's only writer already
  satisfies the implicit invariant, and a comparator-side fix is
  source-of-truth for both `pickLatestOpenSession` call sites
  without coordinating with whoever else might write the file.
- No change to `runConnectorSync` output. Sync's error line was
  designed without a session suffix in the original spec
  (`docs/superpowers/specs/2026-05-09-mega-connector-sync-design.md`),
  and sync's tests pin that contract. Touching sync output here
  would be scope creep; if symmetry across the two commands is
  desirable, it belongs in a separate slot before `--json`.
- No new exports from `apps/cli/src/commands/connector.ts`.
- No new tests on `runConnectorSync`'s ranking; the comparator
  change is verified once on `runConnectorStatus`'s side.
- No fix for S3–S11 in this slot.

## §3 S1 — comparator change

### Current implementation

`apps/cli/src/commands/connector.ts:55-63`:

```ts
function pickLatestOpenSession(
  sessions: readonly Session[],
  agentId: ConnectorTarget["agentId"],
): Session | null {
  const candidates = sessions.filter(
    (s) => s.endedAt === null && s.agentId === agentId,
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, current) =>
    current.startedAt > latest.startedAt ? current : latest,
  );
}
```

### New implementation

```ts
function pickLatestOpenSession(
  sessions: readonly Session[],
  agentId: ConnectorTarget["agentId"],
): Session | null {
  const candidates = sessions.filter(
    (s) => s.endedAt === null && s.agentId === agentId,
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, current) =>
    Date.parse(current.startedAt) > Date.parse(latest.startedAt)
      ? current
      : latest,
  );
}
```

### Why this is safe

`Session.startedAt` is `z.string().datetime({ offset: true })`,
parsed at the registry boundary; reaching this function means the
field was a valid RFC 3339 timestamp. `Date.parse` returns a
finite number for every input the schema admits. NaN compares to
anything as `false`, so a hypothetical schema-violating input
keeps `latest` rather than producing a wild result — but the
schema gate makes this branch dead code, not an active fallback,
so it is consistent with §13 ("no fallbacks for impossible
cases").

### Test

One new behavioural test for `pickLatestOpenSession` itself, added
to `apps/cli/test/connector.test.ts` (the existing connector test
file). The test seeds two open `claude-code` sessions whose
lexicographic compare disagrees with their numeric (instant)
compare:

| field         | session A             | session B           |
|---------------|-----------------------|---------------------|
| `startedAt`   | `2026-05-09T10:00:00+02:00` | `2026-05-09T09:00:00Z` |
| UTC instant   | 08:00                 | 09:00 (later)       |
| lexicographic | A wins (`"10..." > "09..."`) | — |
| numeric       | B wins (later instant) | — |

The test seeds these two sessions in a registry, runs
`mega connector status` against a project where both files are
absent (so the only emitted bytes are the per-target lines), and
asserts that the claude-code line carries `session=<B's id>`.
Failing the test is the comparator-not-fixed signal.

The test is exposed at the same level as the rest of
`connector.test.ts` (no new file). It does not mutate any other
behaviour and does not depend on T1–T4 from the prior plan.

## §4 S2 — error line session suffix

### Current behaviour

`apps/cli/src/commands/connector.ts:284-318` (within
`runConnectorStatus`):

```ts
const sessions = registry.listSessions(project.id);
let anyDriftOrError = false;
for (const target of targets) {
  try {
    // ...
    const session = pickLatestOpenSession(sessions, target.agentId);
    const sessionLabel = session === null ? "none" : session.id;
    // missing → formatStatusLine(target, "missing", sessionLabel)
    // no-block → formatStatusLine(target, "no-block", sessionLabel)
    // in-sync → formatStatusLine(target, "in-sync", sessionLabel)
    // drift   → formatStatusLine(target, "drift",   sessionLabel)
  } catch (err) {
    anyDriftOrError = true;
    input.stdout(formatStatusLine(target, "error"));   // no session
    // mapErrorToCliMessage + stderr
  }
}
```

### New behaviour

The session label is computed once per target, BEFORE the
try/catch, so both the success branches and the catch branch use
the same value:

```ts
const sessions = registry.listSessions(project.id);
let anyDriftOrError = false;
for (const target of targets) {
  const session = pickLatestOpenSession(sessions, target.agentId);
  const sessionLabel = session === null ? "none" : session.id;
  try {
    // ... missing/no-block/in-sync/drift logic, reusing sessionLabel ...
  } catch (err) {
    anyDriftOrError = true;
    input.stdout(formatStatusLine(target, "error", sessionLabel));
    // mapErrorToCliMessage + stderr unchanged
  }
}
```

`pickLatestOpenSession` is a pure function over already-loaded
data and cannot throw on schema-valid input. Hoisting it above the
try/catch is therefore a clean refactor with no new failure
surface.

### Bonus: closes S12 for free

`buildConnectorContext` itself calls `pickLatestOpenSession`
internally. The hoisted variable is not threaded into
`buildConnectorContext` (its signature stays
`(target, project, allSessions)` for cross-package symmetry with
the rest of the code path); inside the function the call computes
the label twice per target. That's the cosmetic-only S12
"per-target session compute dedup" finding. We accept the second
compute as deliberate: keeping `buildConnectorContext`'s shape
stable preserves its self-contained contract. The S12 finding is
considered closed not by deduplication but by the explicit
decision to keep the duplicate. The wiki Status section is updated
accordingly.

## §5 Test changes

Two existing assertions in
`apps/cli/test/connector-status.test.ts` flip from the old
session-less line to the new suffixed line. Both live in the
"error + cross-target" describe block.

1. The `block_conflict` test (sentinel duplication, no seeded
   session). Expected line goes from
   `"claude-code  CLAUDE.md  error"` to
   `"claude-code  CLAUDE.md  error  session=none"`. Exit code,
   stderr fragments, and stdout count are unchanged.
2. The `unreadable file` test (`chmod 0o000`, no seeded session).
   `lines[0]` goes from `"claude-code  CLAUDE.md  error"` to
   `"claude-code  CLAUDE.md  error  session=none"`. `lines[1]`
   (codex `missing`) is unchanged.

The cross-target mixed-state test does not need to change because
the path it exercises emits `in-sync` + `drift`, not `error`.

One new test for `pickLatestOpenSession` lives in
`apps/cli/test/connector.test.ts` (NOT in
`connector-status.test.ts`) so the comparator coverage stays
co-located with the function it tests:

```ts
it("ranks open sessions by numeric instant, not lexicographic order", async () => {
  // Two open claude-code sessions where lexicographic > disagrees
  // with the actual UTC instant. The earlier-by-string is later
  // by instant; mega connector status must report the latter.
  // Seed:
  //   - sess-A startedAt 2026-05-09T10:00:00+02:00 (UTC 08:00)
  //   - sess-B startedAt 2026-05-09T09:00:00Z      (UTC 09:00)
  // Project files do not exist, so the per-target output is
  // dominated by the session-id field.
  // Assertion: claude-code line ends in `session=<sess-B-id>`.
});
```

The test follows the same `mkdtemp` + spy pattern used elsewhere
in the file. Total CLI test delta: +1 (S1 new) and 2 mutations
(S2 wording flips, no count change). 119 → 120 CLI; 379 → 380
total.

## §6 Spec / wiki updates

The earlier `mega connector status` design spec and wiki entries
are updated to reflect the new contract:

- `docs/superpowers/specs/2026-05-09-mega-connector-status-design.md`
  - §0 TL;DR: drop the parenthetical "no session suffix on `error`".
  - §4 Output: change the wording from "(no session suffix on
    `error`)" to "(every status word emits a session suffix)" and
    add a worked-example error line showing `session=none`.
- `wiki/entities/cli.md` → `mega connector status` subsection:
  drop the "(no session suffix on `error`)" parenthetical so the
  prose matches the new contract.
- `wiki/index.md` Status section: replace the "S1 / S2 / S12 …"
  bullets in the open follow-up list with a single "closed in
  PR #TBD" pointer (PR slot filled post-merge). The remaining S3–
  S11 bullets stay open.

## §7 Out of scope (explicit)

- S3 prologue extraction.
- S4 connector.ts file split (still 366 LOC; tracked).
- S5 read-path symlink hardening.
- S6 upsertBlock byte-equality regression fixture.
- S7 separate `pickLatestOpenSession` multi-session test for the
  same-instant-different-id tie-break (we test the differing-
  instant case here; the tie-break is its own slot).
- S8 `--target` help-text wording.
- S9 spec §4 example gutter typo (3-space vs 2).
- S10 spec §11 concurrency stanza.
- S11 `targets.length > 0` invariant.

## §8 Risk

MEDIUM. Single-package change (`apps/cli`). One behavioural fix
(S1), one shape fix (S2), one prose-only spec update. No Core
schema change. No public surface change. Full superpowers chain
applies; code-reviewer + critic v0.2 followup pass before merge.
