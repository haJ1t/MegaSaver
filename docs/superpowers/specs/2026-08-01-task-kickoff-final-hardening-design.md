# Task Kickoff Final Hardening Design

> **Date:** 2026-08-01
> **Status:** APPROVED — the user authorized continuous implementation on 2026-08-01.
> **Risk:** HIGH — this corrects installed hook ownership, post-delivery accounting, and the release artifact gate.
> **Amends:** `2026-08-01-task-kickoff-safety-amendment-design.md`.

## 1. Trigger

Fresh final code review and adversarial review found four release blockers after
the original safety amendment: commands written by the supported `mega.mjs` and
`dist/cli.js` launchers were not recognized on reinstall/uninstall; the
post-stdout task-kickoff event writer followed a stable symlink; the timeout
text claimed an impossible guarantee after `stdout.write` had already queued
bytes; and the standalone bundle's 12 MiB ceiling was not exercised in CI.

The final hardening pass preserves the approved at-most-once, fail-open
semantics. It adds no automatic retention, proxy rewriting, or Bash mutation.

## 2. Decisions

### 2.1 First-party launcher recognition

Hook settings recognize only the launchers Mega Saver itself writes:

- bare `mega`;
- absolute or quoted absolute `mega` and `mega.mjs` paths;
- absolute or quoted development paths ending in either
  `apps/cli/dist/cli.js` or `@megasaver/cli/dist/cli.js`;
- the equivalent explicit Windows `mega.cmd` and `mega.exe` paths.

Commands must still be exactly `<launcher> hooks <known-subcommand>` with the
existing optional store flag. This permits idempotent repair, status, and
uninstall for the published single-file bundle and the development distribution
without adopting arbitrary wrapper commands.

An upgrade from the broken launcher-matcher release collapses duplicate owned
commands to one command per hook surface. It preserves a foreign command that
shares an entry, including that entry's original matcher and metadata, and
leaves a foreign-only entry unchanged. The retained Mega Saver command gets a
new separate entry whenever keeping it in place would change a foreign hook's
matcher.

Ownership parsing is deterministic, not a backtracking regular expression.
It tokenizes only the limited hook-command grammar (unquoted non-space tokens
and quoted tokens with no embedded quote), validates the optional store pairs,
then classifies the launcher path. Malformed quoting or trailing tokens are
foreign commands.

### 2.2 Event-file owner-only boundary

`task-kickoff.jsonl` is task-kickoff state. After stdout delivery, its event
append must refuse a stable symlink or non-regular event-file target. The
append uses a descriptor opened with `O_NOFOLLOW | O_NONBLOCK`, validates it
as a regular file, and applies owner-only mode through that descriptor before
writing. `O_NONBLOCK` ensures a stable FIFO is refused rather than blocking the
hook before `fstat` can reject it. The claim/pack preflight already validates
the stable directory chain; the explicitly documented active same-effective-UID
replacement race remains out of scope.

The isolated-process FIFO regression uses a 1,000 ms test watchdog. That ceiling
includes scheduler admission, Node startup, and TypeScript import under the full
parallel Turbo gate; it is not a product deadline. The hardened append must exit
with status 1 and no signal after the kernel returns `ENXIO`. A deliberate
control without `O_NONBLOCK` must still exceed the watchdog, proving the larger
harness allowance does not accept the legacy blocking behavior.

The failed append is a safe false negative: the already locally queued response
can have no accounting row, and the session claim remains terminal.

### 2.3 Irreversible stdout boundary

The 500 ms deadline guarantees that the parent stops *Mega Saver work* at the
deadline. A successful `stdout.write(envelope, callback)` call is irreversible:
if it was issued before the deadline, bytes can drain after it. The parent must
not claim that it can retract those bytes. It resolves the hook failure path and
never requests accounting unless the write callback succeeded before the same
deadline. A late callback therefore yields no event. The documented timeout
contract is "no output is queued when preparation is incomplete before the
write boundary," not "no bytes can drain after a pre-deadline write."

The worker's task-pack persistence is asynchronous. Best-effort intent capture
is allowed to retain its existing synchronous atomic writer inside the isolated
worker; it never runs in the parent and may be abandoned with the worker.

### 2.4 Canonical project roots

Task Kickoff resolves a registered project through asynchronous canonical paths
before assembling a pack. This supports macOS `/tmp` → `/private/tmp` aliases
and ordinary project-root symlinks without changing the lexical resolver used
by unrelated commands. Matching ranks descendants by canonical-root length, not
by a registered alias spelling; the selected project still retains its original
registered root as its workspace identity. A canonical filesystem root such as
`/` or `C:\\` contains its native-separator descendants. Failure to resolve the
cwd emits no optional output, while an unresolvable registered candidate is
excluded. If multiple registered projects tie for the deepest canonical root,
Task Kickoff emits no optional output and creates no claim: choosing by an
alias spelling could bind context, event attribution, and the terminal session
claim to the wrong project.

### 2.5 Release bundle gate

The single-file bundle enables full minification while retaining function and
class names required by introspection and existing GUI smoke coverage. The
artifact must remain below 12 MiB. CI builds it under Node 22 and runs the
focused existing bundle tests that prove the size ceiling, Task Kickoff
self-worker path, native-dependency exclusions, and GUI-bridge inclusion. The
self-worker smoke is platform-aware: POSIX proves a delivered Task Kickoff
envelope/event; Windows proves the same bundle exits zero with empty stdout and
no Task Kickoff event, matching its deliberate no-state contract.

The runtime-cancellation fixture has two evidence modes because optional worker
preparation is allowed to remain incomplete at the fixed 500 ms product
deadline. In the normal full suite, a run where the fake Git process never
starts is accepted as incomplete preparation, but the late-survival marker must
always remain absent. If Git does start, that same absence proves cancellation
prevented the delayed write. The dedicated CI Bundle smoke enables a narrowly
named strong mode: on POSIX it additionally requires the Git-start marker before
asserting the late marker is absent. Windows retains its deliberate no-output,
no-state behavior and therefore never requires Git to start, even in that CI
step. The strong mode is test evidence only; it does not change the product
deadline, add a retry, or weaken cancellation semantics.

The Node 22 full gate uses deterministic, nondegenerate, exact-50,000-byte
unique-code-line Bash corpora for the two CLI evidence-ledger tests that exercise
the real `recordAndFilterOverlayOutput` dependency and for the `makeRecord`
daemon/fallback integration fixture. The sizes are not reduced and the real
paths are not mocked: the evidence-ledger tests still prove a compressed hook
response, persisted chunks, exactly one overlay event with the 50,000-byte raw
measurement and measured token fields. The successful evidence path
additionally proves exactly one evidence record with returned chunk references
plus a non-redacted redaction report. The injected evidence-write failure proves
zero evidence records while the compressed response, persisted chunks, and
overlay event survive. The `makeRecord` fixture still exercises daemon transport,
direct daemon persistence, in-process fallback persistence, and fallback
accounting. This replaces only pathological `X.repeat(50_000)` test corpora whose
real-BPE TypedArray slicing/joining and allocation/GC exceed the RPC deadline
under the parallel full gate; it does not change product behavior.

### 2.6 Process-entry deadline, descendant-safe cancellation, and workspace keys

The 500 ms Task Kickoff budget begins in the CLI entry module before it
dynamically imports Citty or the full command graph. The entry records a
process-local timestamp in a small deadline module; `hooks intent` consumes
that timestamp when it passes its absolute deadline to the parent/worker
protocol. Direct library callers that did not pass through the CLI entry retain
the existing fresh-call fallback. A cold or contended command-graph import can
therefore consume the optional-work budget, but it cannot create a second 500
ms window. The main process still performs no Task Kickoff filesystem work.

On POSIX, co-change Git runs in its own process group. The existing worker
abort signal terminates that group, so a Git wrapper's ordinary descendants
cannot outlive cancellation and mutate a delayed marker after the hook has
exited. If group termination is unavailable after a spawn race, the direct
child is terminated as a best-effort fallback; this is not a retry. Windows
continues to return before Git or Task Kickoff state is created, so no Windows
process-tree guarantee is claimed. The strong bundle fixture requires the
direct fake Git process to start and gives it a non-detached child that writes a
late marker only if group cancellation fails.

Every Task Kickoff path that interpolates a workspace key validates the
existing fixed-length lowercase-hex `workspaceKeySchema`, including public
stats event paths and the pack-storage facade. Invalid public input fails
closed before a directory is prepared, read, or written; production continues
to derive this key with `encodeWorkspaceKey`.

Task Kickoff must not cold-start the embedding pipeline. Its fresh worker uses
the deterministic approved-memory-files fallback when constructing a context
pack, even if a memory-vector sidecar is present. The interactive context
command retains its existing task-scoped embedding behavior. This preserves a
bounded one-shot hook rather than repeatedly downloading or initializing the
embedding model inside workers that are cancelled near the deadline.

Hook commands generated by Mega Saver use POSIX single-quoted arguments with
the standard embedded-single-quote split. The restricted ownership tokenizer
recognizes that exact safe form as well as the established simple forms, so an
absolute launcher or `--store` path containing whitespace, dollar signs,
backticks, quotes, semicolons, or ampersands cannot be expanded by the hook
shell or become an unowned duplicate. This changes command rendering only; it
does not execute arbitrary shell syntax.

The process-entry budget cannot interrupt the operating system while a slow
hook writer is still delivering stdin. The parent therefore caps ingress at
256 KiB with a byte-bounded synchronous reader and rejects oversize available
payloads before JSON parsing or Worker structured cloning. This protects the
optional-work budget from a large completed payload without falsely promising
to preempt a blocking pipe read; all rejected input remains fail-open with no
Task Kickoff output or state.

## 3. Required evidence

- official `mega.mjs`/`cli.js` hook commands are repaired, reported, and
  removed without touching a foreign wrapper;
- a stable `task-kickoff.jsonl` symlink neither changes its target nor records
  an event;
- the isolated FIFO child exits with `ENXIO`/status 1 within its 1,000 ms test
  watchdog under the parallel gate, while the blocking control times out;
- a late stdout callback has queued bytes but authorizes neither an event nor a
  success result, with the public specification using the honest boundary;
- a canonical `/tmp` fixture creates one normal Task Kickoff response;
- Node 22 builds `mega.mjs` below 12 MiB, exercises the self-worker, and CI
  runs the same focused release checks; its dedicated POSIX Bundle smoke
  requires the cancellation fixture to reach fake Git and then proves the
  delayed marker never appears, while the normal suite accepts incomplete
  preparation but always rejects a late marker;
- a process-entry timestamp leaves no new 500 ms window after command-graph
  loading; a POSIX Git wrapper's ordinary delayed descendant is absent after
  cancellation; and invalid Task Kickoff workspace keys cannot escape a public
  event or pack path;
- a vector-sidecar project never cold-starts embeddings in Task Kickoff; a
  generated hook command safely preserves special-character launcher/store
  paths; and a completed ingress over 256 KiB is rejected before JSON parsing
  or Worker cloning while a slow-pipe read remains explicitly outside the
  deadline claim;
- the two real evidence-ledger saver tests and the `makeRecord` daemon/fallback
  integration fixture process deterministic exact-50KB unique-code-line corpora
  promptly while preserving real compression, persistence, transport,
  fallback-accounting, overlay-event, and token-measurement evidence; the
  successful evidence write carries one record with chunk references and a
  non-redacted report, while the injected failure carries none without losing
  compression or recovery;
- focused tests, `pnpm verify`, a real installed-hook receipt, and fresh
  code-reviewer plus critic passes are clean.
