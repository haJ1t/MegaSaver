---
feature: exec-rewrite-saver
date: 2026-08-06
updated: 2026-08-13
risk: HIGH
status: draft-design
pending: [user-spec-review, architect-pass]
reviewers: [code-reviewer, critic]
build-order: "1 of 20 (wave-2 batch)"
---

> Refreshed 2026-08-13 against `main@v2.6.0` (v2.7 selection,
> `wiki/decisions/v27-net-positive-saver.md`). Changes: Q1 resolved with
> official-docs evidence, LD2 full-replacement contract correction, Q3
> resolved (LD11), new LD10 launcher-path gate, LD12 saver exemption,
> LD13 exec-live self-validation, LD14 record input (evidenceStoreRoot +
> content-derived newId), LD15 bounded capture, stats selector deferred,
> first-sight claim structurally confirmed, mesh-interplay check added.
> Architect pass 2026-08-13: APPROVE-WITH-CHANGES — P1s F1 (saver
> re-compression), F2 (un-gated spawn), F3 (plan drift) all folded into
> the LDs above; P2s M1 (timeout threading), M2 (maxBytes), M4/M5
> (record input) folded; M3 (hook-kill) documented; YAGNI cut applied.
> All line citations re-verified against the current tree.

# Exec-Rewrite Saver (wave-2 #1)

## Problem

(Reframed 2026-08-13 after the 2026-07-30 retraction in
`wiki/syntheses/saver-cache-churn.md`: the in-place-churn mechanism
cannot occur — PostToolUse `updatedToolOutput` lands BEFORE first send
and history is immutable. The honest, still-open costs are different:)

The PostToolUse saver sees output AFTER the client has already
truncated it — "Claude Code truncates Bash output at ~30 000 chars
before the hook sees it" (apps/cli/src/hooks/saver.ts:30-32, B9).
Consequences, all measured or code-proven:

1. **Losslessness ceiling.** Bytes past the ~30k truncation never reach
   the saver; a 300 KB failing build log is destroyed before Mega Saver
   can persist it. The chunk-store "lossless" promise covers at most
   the truncated 30k.
2. **Compression band is 24–30 KB.** `BASH_COMPRESS_FLOOR` (24k) sits
   just under the truncation cap — the win band is a 6 KB sliver.
3. **The cache writes the saver's compressed-but-truncated bytes.**
   Cache-write cost scales with suffix bytes; today the suffix carries
   the full truncated tool_result.

RTK proved the structural fix — rewrite the COMMAND before execution so
the compressed output is the only version that ever exists
(`wiki/syntheses/rtk-competitive-analysis-2026-08-01.md` §3.3) — but
RTK is lossy and its `rtk gain` scoreboard is fiction (96.2M tokens
"saved" while the bill rose 7.6%, ibid. §2). With our chunk store the
same mechanism is honest and lossless: the client truncation applies
to the compressed form (which fits — enforced, not assumed: LD16
falls back to raw when the compressed delivery would exceed the
client cap), the cache writes only the
compressed bytes, and the FULL raw persists chunk-store-side behind a
recovery footer. `cache-write-cost-reduction-2026-08-01.md` §2 row 3
names this mechanism as the spec'd direction: RTK's mechanism, our
chunk-store losslessness.

## Goal

Opt-in PreToolUse mode that rewrites eligible agent Bash commands to run
through a live-session-keyed exec path BEFORE execution. The compressed
(chunk-store-backed, recovery-footer'd) output is the only version the
client ever caches — the client truncation cap applies to the compressed
form, never to the raw evidence. When the filter declines, delivery is
byte-identical raw. Failing commands always have their full raw
persisted. Rewritten-path savings are counted separately with the
existing honest event pipeline — no counterfactuals. This path needs NO
first-sight ledger: nothing is ever rewritten after the client has seen
it (complements net-positive Stage A).
Confirmed structurally 2026-08-13: the seen ledger is caller-side
best-effort in saver-run (saver-run.ts:91, `saver-seen.ts`) — the record
path itself never consults it, so exec-live calling `makeRecord` bypasses
first-sight by construction. Content-derived chunk-set ids (v2.3)
additionally keep footers stable across identical re-runs.

## Non-Goals

- Not default-on (install flag AND workspace enablement required, LD9).
- Bash only. Read/Grep/Glob stay on the PostToolUse path.
- No shell-string interpretation: pipes, quotes, env-prefixes, heredocs,
  substitutions are never rewritten (flat-token grammar only).
- No script runners (`pnpm test`, `npm run`) in v1 — Open Q2.
- No new package, no MCP tools, no new persisted file formats.
- No savings dashboard: v1 ships the `origin` event field + a pure stats
  selector; UI surfacing is follow-up.
- No change to `mega output exec` (registry-keyed) semantics.

## Locked Decisions

- **LD1 — Own hook subcommand, not a guard-run extension.** New
  `mega hooks exec-rewrite` with its OWN PreToolUse entry, matcher
  `^Bash$`. The batch-1 mesh decision (piggyback existing handlers to
  avoid spawns) governs default-on handlers; a command-REWRITING behavior
  earns an explicit, auditable, independently-removable settings.json
  entry. Piggybacking on guard would (a) add opt-in config IO to every
  Bash call for ALL users, (b) couple two output contracts in one process
  (guard emits `additionalContext`/`deny`, guard-run.ts:212-224; rewrite
  emits `updatedInput`), (c) bury a mutating capability inside a
  default-on hook. Accepted cost: +1 spawn per Bash call, opted-in only.
- **LD2 — Rewrite via `hookSpecificOutput.updatedInput`, NEVER
  `permissionDecision`.** Guard-run's "NEVER allow" discipline
  (guard-run.ts:221) holds: the user's permission system evaluates the
  REWRITTEN command itself; opt-in docs advise allowlisting the mega
  launcher. **Full-replacement contract (verified 2026-08-13 against the
  official hooks reference):** `updatedInput` REPLACES the entire
  `tool_input` object — "include unchanged fields alongside modified
  ones". The hook therefore echoes the full received `tool_input` with
  only `command` replaced: `updatedInput: { ...toolInput, command:
  "<rewritten>" }` (preserves `description` and any future Bash
  tool_input keys). Docs evidence for the rest of Q1: `updatedInput` is
  documented for PreToolUse directly under `hookSpecificOutput`; "Each
  field the event supports is honored, including permissionDecision,
  additionalContext, updatedInput"; the only field-interaction rule is
  "For `defer`, ignored" — no `permissionDecision` is documented as
  required; no version gate is attached; no re-fire on updated input is
  documented (loop safety rests on our classifier refusing mega
  launchers, LD5); cross-hook decision precedence `deny > defer > ask >
  allow` means a guard DENY still blocks the call. The one residual
  assumption — `updatedInput` alone (no `permissionDecision`) takes
  effect in practice — stays a Task-1 runtime probe (plan Q1 gate); if
  the probe shows it requires `"allow"`, STOP and return to spec review
  per LD2.
- **LD3 — Rewrite target is a new `mega output exec-live`,** keyed
  `(workspaceKey = encodeWorkspaceKey(cwd), liveSessionId = session_id)`
  — the hook has no registry session. Identity mirrors the daemon
  `execHandler` (packages/daemon/src/handlers.ts:117) and the overlay
  record path.
- **LD4 — exec-live pipeline = `runChild` + `recordAndFilterOverlayOutput`
  (daemon-first via `makeRecord`), NOT `runOverlayOutputExecCommand`.**
  The record path returns the raw byte-identical on every non-compressed
  decision (packages/context-gate/src/record-output.ts:255-266), owns the
  F30 footer accounting (footer bytes count into returnedBytes,
  record-output.ts:122-124), and carries the net-negative degradation
  guard. `runOutputExecCommand`'s envelope never returns raw and cannot
  honor byte-identical passthrough. `runChild` combines stdout+stderr in
  arrival order (run-command.ts:115) — same merged semantics as the
  Bash `tool_result` string, so single-part delivery needs no
  `streamSlot`.
- **LD5 — Decision function = flat-token allowlist grammar** (discipline
  of `apps/cli/src/hooks/output-route-command.ts`): ASCII-space tokens,
  SAFE_TOKEN class, ≤64 tokens, ≤4096 bytes, null-biased. Allowlist
  seeded from existing parser coverage (packages/output-filter/src/
  parsers/): `vitest`, `tsc`, `pytest`, `eslint`, `go test`, `cargo
  {test,build,check,clippy}`; plus read-only `git
  {status,log,diff,show}` (`branch` is OUT — its -d/-D/-m/--delete
  flags mutate the repo and the flat-token grammar cannot vet them;
  critic P1-3) and `ls`/`grep`/`rg`/`find`. Per-program
  vetoes: watch flags (`--watch` global; `-w` vetoed for vitest/tsc —
  `-w` is legal word-match for grep/rg; `vitest watch` positional),
  `find
  -delete/-exec/-execdir/-ok/-okdir`. Any token whose program basename is
  a mega launcher (`mega`, `mega.mjs`, `mega.cmd`, `mega.exe`) → never
  rewrite (also makes hook re-entry a structural no-op). Everything not
  allowlisted — sudo, editors, REPLs, watchers, servers, shell syntax —
  is null by construction.
- **LD6 — Semantics-parity invariant.** exec-live must never change what
  the command would have done: any mega-internal failure (store resolve,
  settings, record throw, daemon error) degrades to plain `runChild`
  capture delivered raw; the child's exit code is always mirrored
  (exec.ts:165-167 precedent). The rewrite may improve delivery, never
  behavior.
- **LD7 — Failure-tee parity (RTK idea 7).** `storeRawOutput: true`
  always on this path — the rewrite replaced the only copy the agent
  would have had. Non-compressed decisions deliver full raw anyway;
  compressed decisions carry the recovery footer declaring chunk
  recoverability (recovery-footer.ts:36); non-zero exit adds stderr
  `note: command exited N`.
- **LD8 — Honest stats.** Additive optional `origin: "exec-rewrite"`
  threaded `RecordOverlayOutputInput` (no `origin` field today,
  record-output.ts:91) → `overlayTokenSaverEventSchema` (`.strict()`,
  packages/stats/src/event.ts:72) → daemon `excerptRequestSchema`
  (`.strict()`, handlers.ts:23 — omit it and the daemon 400s, hook falls
  back in-process; the schema's existing `chunkSetId`/`streamSlot`
  optional fields document this exact 400→in-process pattern).
  Savings = actual rawBytes vs returnedBytes from the existing pipeline
  only. The RTK `rtk gain` counterfactual ("raw priced as fresh input
  even when the client would have truncated it") is the named
  anti-pattern — we never model what output "would have cost".
  `childExitCode` on saver events is OWNED by claim-verification-gate
  (batch-1, build 3, still unshipped as of v2.6.0): consume it once
  merged, never duplicate.
- **LD9 — Dual activation gate.** Rewrite fires only when (a) the hook
  entry is installed (`mega hooks install claude-code --exec-rewrite`,
  default off; `--no-exec-rewrite` removes; flag absent preserves current
  state — same tri-state pattern as `--mesh-hints`,
  install.ts:58) AND (b) `resolveWorkspaceTokenSaverSettings(storeRoot,
  cwd, nodeResolverDeps())` reports enabled (saver-run.ts:35).
- **LD10 — Launcher-path gate (rewritten 2026-08-13 after architect
  pass).** No POSIX-only carve-out and no shell quoting: the rewrite is
  emitted only when BOTH the launcher path and the store path are
  SAFE_TOKEN-class (the `output-route-command.ts` class,
  `/^[A-Za-z0-9_./:@%+=,-]+$/`) — decline otherwise (fail-open, raw
  Bash runs). This is honest about Windows: a `C:\...\mega.cmd`
  launcher path is not SAFE_TOKEN and declines by construction; no
  cmd.exe quoting problem ever arises. `quoteForPosixShell` in
  hook-settings.ts:47 is NOT exported and stays internal; the hook
  runner needs no connector import. Windows coverage = `windows-latest`
  CI unit tests only (no runtime hook probe in v1) — same posture as
  the guard.
- **LD11 — exec-live timeout: thread the tool's own timeout (resolves
  Q3, corrected after architect pass).** Claude Code's Bash
  `tool_input` carries `timeout` (ms, default 120s; task-0 probe
  confirms the shape). The hook passes `--timeout` = ceil(ms/1000)
  when the field is present and positive; otherwise exec-live defaults
  to 600s (≥ the Bash tool max) so the tool's own timeout remains the
  governing bound. A 300s default would kill children the native call
  would have let run — an LD6 parity break (architect P1).
- **LD12 — PostToolUse saver exemption (architect P1/F1).** The saver
  hook MUST NOT re-compress exec-live output: the existing C13
  passthrough exemption (saver.ts:337-344,
  `/\bmega\s+output\s+chunk\b/`) is extended to
  `/\bmega\s+output\s+(?:chunk|exec-live)\b/`. Without it the PostToolUse
  saver   fires on the rewritten command, the first-sight ledger admits a
  second compression, and the model receives double-compressed text
  with footer-on-footer plus garbage chunk sets — self-inflicted
  re-compression this feature must prevent by construction. Test
  proves: exec-live command → saver PASSTHROUGH, single overlay event.
- **LD13 — exec-live re-validates its own input (architect P1/F2).**
  `runChild` performs no policy check (run-command.ts:114: "Callers
  MUST gate via evaluateCommand BEFORE invoking"). exec-live therefore
  re-runs `classifyExecRewrite` on its own positionals and refuses any
  non-conforming command with exit 1, no spawn, no store I/O. The
  flat-token allowlist becomes a structural invariant of the delivery
  path — not a caller honor-system — closing the public un-gated spawn
  surface (parse-on-handoff policy).
- **LD14 — exec-live record input (architect P2).** The record call
  threads: `evidenceStoreRoot: storeRoot` (evidence parity between
  daemon and in-process fallback, record-output.ts:472-510) and
  `newId: () => "cs-" + <content hash slice>` content-derived
  (saver.ts:425 pattern; the `makeRecord` daemon bridge already
  serializes the derived id, saver-run.ts:159-163). Without `newId`,
  every re-run mints a fresh randomUUID chunk-set id, footers differ
  across identical re-runs and orphan chunk sets pile up. Floor stays
  `minBytesFor("Bash", mode)` — consistent compression economics; the
  churn win is size-independent (exec-live output is always
  first-seen). **Canonical cwd (smoke-found 2026-08-13):** workspace
  identity is canonical-path keyed — exec-live canonicalizes
  `realpath(cwd)` (fallback: raw spelling) before
  `resolveWorkspaceTokenSaverSettings` AND `encodeWorkspaceKey`, and
  the hook gate (LD9 b) canonicalizes the payload cwd the same way.
  Without it, getcwd's resolved real path (`/private/var/...` on
  macOS) and a symlinked payload spelling (`/var/...`) derive
  different workspace keys and the settings gate silently fails
  closed — cache-advice-run.ts:125 precedent.
- **LD15 — Bounded capture (architect P2/M2).** exec-live names its
  capture bound explicitly: `maxBytes` default 100_000_000. Documented
  deviation: the native Bash tool truncates display but lets the
  command finish; `runChild` kills the child at maxBytes
  (run-command.ts:161-168). Chosen deliberately — bounded wrapper
  memory, DoS backstop — at a bound far above real-world agent output;
  bytes past the bound are unrecoverable (the failure tee covers only
  captured bytes).
- **LD16 — Delivered-text cap (critic P1-1, added 2026-08-13).** The
  client truncates Bash output at ~30 000 chars and the recovery
  footer is the LAST bytes of the delivered text — a compressed
  delivery above the cap would be truncated with its recovery pointer.
  exec-live therefore falls back to raw byte-identical delivery when
  compressed+footer exceeds `EXEC_LIVE_MAX_DELIVERED_CHARS = 28_000`
  (evidence stays persisted via storeRawOutput; the model sees native
  truncation, never truncated-compressed-without-pointer). Known
  residual (critic-recheck P2, accepted): a fallback run still
  persists a compressed-basis event row even though the model received
  the raw — the row is excluded from every aggregate by LD17 and is
  flagged for the origin-aware presentation wave, which must label it
  (or re-basis it) before showing it anywhere.
- **LD17 — Origin rows are unaggregated (critic P1-2).** Origin-bearing
  events append to the authoritative JSONL but are EXCLUDED from the
  overlay summary fold, rebuild, and reconcile comparison, AND from
  `mega audit honest`'s direct event loader: their
  full-raw measurement basis differs from the PostToolUse path (the
  client would never have paid for raw bytes past the truncation —
  the LD8-named anti-pattern), so folding them into the shared totals
  would inflate every existing consumer (hooks status, sessions live
  burn, audit, GUI) with unmeasured counterfactuals. Origin-aware
  presentation ships with the UI wave; until then the rows are
  collected, never claimed.

## Architecture

```
PreToolUse(Bash) payload {session_id, cwd, tool_input.command}
  -> mega hooks exec-rewrite (own entry, matcher ^Bash$, opt-in)
     classifyExecRewrite(command)        null -> emit nothing (raw Bash runs)
     workspace saver enabled?            no   -> emit nothing
  -> {"hookSpecificOutput":{"hookEventName":"PreToolUse",
       "updatedInput":{ ...fullToolInput, "command":
         "<mega> output exec-live --live-session <sid> [--store <s>] -- <tokens>"}}}
  (permission system evaluates the rewritten command; agent's Bash runs it)

mega output exec-live
  -> runChild (shell:false, timeout/max-bytes bounds)     [context-gate]
  -> settings enabled? no -> deliver raw, mirror exit code
  -> record = makeRecord(storeRoot)  (daemon /excerpt first, in-process
     recordAndFilterOverlayOutput fallback)  with:
       storeRawOutput:true, includeFooter:true, origin:"exec-rewrite",
       intent: readSessionIntent(storeRoot, wk, liveSessionId)
  -> compressed  -> deliver returnedText (footer inside, chunks recoverable)
     otherwise   -> deliver raw byte-identical
  -> stdout via write() (no added newline); exit code = child's
```

## Components

1. **Classifier** — `apps/cli/src/hooks/exec-rewrite-command.ts`,
   `classifyExecRewrite(command): {command, args} | null` (LD5).
2. **Hook runner** — `apps/cli/src/hooks/exec-rewrite-run.ts`
   (`buildExecRewriteHookOutput`, contract identical to
   `buildGuardHookOutput`: never throws, "" on any failure, exit 0) +
   `apps/cli/src/commands/hooks/exec-rewrite.ts` subcommand.
3. **exec-live CLI** — `apps/cli/src/commands/output/exec-live.ts`,
   `runOutputExecLive` (LD4/LD6/LD7), registered in `output/index.ts`.
4. **Origin thread** — context-gate `RecordOverlayOutputInput.origin`,
   stats event field, daemon excerpt schema (LD8).
5. **Install surface** — connector-claude-code `hook-settings.ts`:
   `EXEC_REWRITE_HOOK_COMMAND`/`_MATCHER`, add/has/remove trio (guard
   trio model, hook-settings.ts:451-484), `installClaudeCodeHook`
   tri-state `execRewrite`, uninstall + status; CLI `--exec-rewrite`.
6. **Stats selector — DEFERRED (architect YAGNI cut).**
   `splitOverlayEventsByOrigin` is out of v1: no consumer can call it
   (CLI is forbidden from importing `@megasaver/stats`; no core
   re-export is allowed). `origin` still ships as honest data; the
   selector lands with the UI/dashboard wave.

## Error handling

- Hook: malformed payload, non-Bash tool, unsafe `session_id`, classifier
  null, disabled workspace, any throw → emit "" and exit 0 (fail-open;
  the original command runs untouched). Named limitation (architect M3):
  fail-open covers the hook's exit code and output only — a
  Claude-Code-side hook TIMEOUT kills the hook process and blocks the
  Bash call; the guard hook shares this exposure (accepted precedent).
- exec-live: LD13 classifier refusal → exit 1, no spawn; LD6 parity
  fallback on every internal failure; spawn failure → `error:
  command_failed: <detail>` exit 1; `terminated: timeout|max_bytes` →
  partial delivered, stderr note, exit 1.
- Daemon: `origin`-bearing body against an old daemon → 400 → counted
  daemon-fallback, in-process record proceeds (existing makeRecord
  behavior, saver-run.ts:150-181).

## Security & privacy

- The record path redacts raw and label before persist (`redact`,
  packages/policy/src/redact.ts:44; record-output.ts:274-278) — no new
  redact callsites needed; the hook itself persists nothing.
- Rewritten string is built only from SAFE_TOKEN-classed tokens, a
  validated `session_id` segment, and the launcher path quoted with the
  same SAFE_TOKEN discipline as output-route-command.ts (cli-local;
  connectors' `quoteForPosixShell` is internal and not reused) — no
  injection surface beyond what the agent already typed.
- No permission widening: no `permissionDecision` ever (LD2); a strict
  guard DENY on the same tool call still blocks (deny wins over input
  updates — verify with Q1 probe).
- Loop safety: rewritten commands start with a mega launcher token, which
  the classifier refuses (LD5) — re-entrant hook passes are no-ops.
- No new locks or writers: all persistence goes through the existing
  overlay chunk-store/stats appenders; `withFileLock` is not needed.

## Testing

- Classifier: accept/reject table mirroring output-route-command.test.ts
  (shell syntax, watchers, find mutators, mega targets, byte/token caps).
- exec-live: byte-identical passthrough (stdout === raw, no trailing
  newline added), compressed delivery, storeRawOutput+origin always set,
  exit-code mirroring incl. non-zero + terminated, record-throw parity
  fallback, disabled-workspace raw path, LD13 refusal (non-conforming
  positionals → exit 1, no spawn). Injected `runChildImpl` +
  `record` — no real spawn, no timing-tight assertions.
- Saver interplay (LD12): an exec-live invocation string is classified
  PASSTHROUGH by the saver's decide path — no second compression, one
  overlay event, no footer-on-footer (architect F1 regression test).
- Origin thread: context-gate event carries `origin`; absent-field
  back-compat; daemon strict schema accepts it.
- Record input (LD14): `evidenceStoreRoot` set on both paths; `newId`
  content-derived — identical re-run mints the same chunk-set id.
- Install: entry shape (matcher `^Bash$`, timeout 10), tri-state
  add/preserve/remove, uninstall, status.
- Integrity: the existing save-integrity property
  (packages/context-gate/test/save-integrity.property.test.ts) already
  covers the record path this feature rides.
- Smoke evidence (DoD §5): captured terminal session — install with
  `--exec-rewrite`, pipe a PreToolUse payload, show the rewrite JSON;
  run exec-live over a fixture command showing footer + `mega output
  chunk` recovery; show the PostToolUse saver leaving exec-live
  output untouched (LD12).

## Risk & process

HIGH (§12): public CLI flags + connector core path + saver semantics.
Worktree mandatory (no `main` edits); architect pass on this spec;
`code-reviewer` AND `critic` in separate fresh contexts; `pnpm verify`
plus smoke evidence before any "done"; changesets for cli,
connector-claude-code, context-gate, stats, daemon. No convention-file
changes expected (DoD §10).

## Dependencies / build order

Wave-2 build 1 of 20. Consumes (never duplicates) claim-verification-gate's
additive `childExitCode` when that lands (batch-1 build 3 — unshipped as of
v2.6.0); does not block on it. Independent of net-positive Stage B. Blocks
the wave-2 filter-matrix expansion (idea 3), which wants this delivery path
in place.

Mesh interplay (checked 2026-08-13): v2.6.0 mesh hooks ride the
warmup/saver/guard entries; exec-rewrite's own PreToolUse entry has no
mesh coupling, and the cross-batch contract "no network I/O in any hook
path" holds (local spawn only). Both hooks may fire on the same Bash
call; cross-hook precedence (`deny > defer > ask > allow`) plus
permission-rule re-evaluation mean a guard DENY still blocks the
rewritten command.

## Open questions

- **Q1 (gate) — RESOLVED against the official hooks reference
  2026-08-13.** PreToolUse `hookSpecificOutput.updatedInput` is
  documented; full-replacement semantics (LD2 corrected); no
  `permissionDecision` documented as required; no version gate; no
  re-fire documented; `deny > defer > ask > allow` cross-hook
  precedence. Residual: whether `updatedInput` alone takes effect in
  practice — Task-1 runtime probe; if it requires `"allow"`, STOP per
  LD2.
- **Q2.** Script runners (`pnpm test`, `npm test`) — high-frequency but
  execute arbitrary package scripts; needs a stateful-script analysis
  before allowlisting. Unchanged.
- **Q3 — RESOLVED (LD11).** exec-live defaults to a 600s timeout ≥ the
  Bash tool max, so the tool timeout stays the governing bound; no
  payload threading in v1.
- **Q4.** Whether `mega hooks status` should warn when exec-rewrite is
  installed but the workspace saver is disabled (silent no-op today).
  Unchanged.
- **Q5 (new).** The docs say `updatedInput` is ignored when the decision
  is `"defer"` and that deny/ask rules are re-evaluated regardless of
  hook output. If the user's permission config has an ASK rule for
  `mega output exec-live`, the modified input is shown — acceptable
  (that is the permission system doing its job). No spec change;
  recorded as a known behavior.
