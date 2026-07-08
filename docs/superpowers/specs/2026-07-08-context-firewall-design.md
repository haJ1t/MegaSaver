# Context Firewall — ingress guard audit + PII detection (Pro module 10)

- **Date:** 2026-07-08
- **Release:** 1.12 (N3 in the LOCKED 1.x→2.0 program)
- **Risk:** HIGH (security claim; touches `policy` redaction core and the
  context-gate orchestrator; new persistent store file)
- **Status:** approved (user, 2026-07-08 — scope/PII-set/packaging/architecture
  locked via brainstorm Q&A)

## Goal

Make the existing, silent ingress protection *visible and auditable*, and
extend it to high-precision PII. Three deliverables:

1. **PII detection** in `@megasaver/policy`: credit card (Luhn), IBAN
   (mod-97), TR national id (TCKN checksum) — redacted like secrets; email —
   **observed (counted) but never redacted**.
2. **Firewall ledger**: an append-only, **value-free** local event log of
   every blocked read, redaction, and observation. Always on (free).
3. **`mega firewall`** (Pro, `savings-analytics` key): a windowed audit
   report — "N blocked reads, M redactions by detector, K emails observed" —
   with one advice line per category.

Pitch: *"Your `.env` never reached the model — and you can prove it."*

## Non-goals (this slot)

- No new enforcement points (no proxy_run_command output path-leak analysis,
  no connector-config scanning) — detection surface stays the existing
  context-gate pipeline + path gate.
- No email redaction (counted only — redacting emails corrupts git/package
  metadata the agent legitimately needs).
- No generic/other-country national-id detectors beyond TCKN; no phone
  numbers (unverifiable → false-positive risk). Card/IBAN/TCKN are all
  checksum-verifiable.
- No retroactive scanning of existing chunk stores.
- No GUI surface (CLI only; GUI follows the usual later wave).

## Locked decisions (brainstorm 2026-07-08)

| # | Decision |
|---|----------|
| 1 | Scope = detection + ledger + report (full portfolio one-liner) |
| 2 | PII set = checksummed only (card/Luhn, IBAN/mod-97, TCKN); email = count-only observer |
| 3 | Packaging: detection + ledger always-on free; `mega firewall` report Pro-gated |
| 4 | Architecture mirrors cache doctor: event writer → single JSONL → pure analyzer in `pro-analytics` → thin Pro CLI |
| 5 | Known limit (stated in README + report footer): the firewall guards the **Mega Saver ingress surface** (proxy tools + hooks). Native agent reads bypass it — architecturally forced by §1 "not a model proxy by default" |

## Architecture

```
policy (pure)                    context-gate (orchestrator, IO)
┌──────────────────────┐         ┌───────────────────────────────┐
│ redact() + patterns  │ result  │ run.ts / read.ts /            │
│  + validate hooks    ├────────▶│ run-command.ts call sites     │
│ email observer       │         │  → appendFirewallEvent()      │
│ evaluatePathRead     │ deny    │     (best-effort, never       │
└──────────────────────┘────────▶│      breaks the pipeline)     │
                                 └───────────────┬───────────────┘
                                                 ▼
                              <store>/firewall/events.jsonl  (value-free)
                                                 │
                    pro-analytics: diagnoseFirewall(events, {now, days})
                                                 │
                              apps/cli: mega firewall (Pro gate → report)
```

### 1. `@megasaver/policy` — detection

`RedactionPattern` gains an optional `validate?: (match: string) => boolean`.
`redact()` applies the regex as today, but a match only redacts (and counts)
when `validate` (if present) returns true. New patterns, appended after the
existing 16 (order preserved):

- `credit_card` — 13–19 digit runs incl. space/dash separators; validate =
  Luhn over the digits; replacement `[REDACTED:credit_card]`.
- `iban` — `[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}` word-bounded; validate =
  ISO 13616 mod-97 == 1; replacement `[REDACTED:iban]`.
- `tr_national_id` — 11-digit word-bounded runs; validate = TCKN checksum
  (first digit ≠ 0; d10 = ((sum of d1,d3,d5,d7,d9)·7 − (d2+d4+d6+d8)) mod 10;
  d11 = (d1+…+d10) mod 10); replacement `[REDACTED:tr_national_id]`.

**Return-shape extension (additive, backward compatible):**

```ts
export type RedactResult = {
  redacted: string;
  count: number;                                  // unchanged aggregate
  findings: Array<{ name: string; count: number }>;  // per-detector, redacted
  observed: Array<{ name: string; count: number }>;  // counted, NOT redacted
};
```

All 10 existing call sites destructure `.redacted`/`.count` and keep working
untouched. A separate `OBSERVED_PATTERNS` list holds `email` (RFC-lite
regex); observer matches are counted into `observed`, never replaced.
Ordering note: PII patterns run AFTER the secret patterns, so a card number
inside an already-redacted value is not double-counted (replacement tokens
contain no digits).

### 2. `@megasaver/context-gate` — firewall ledger (writer)

New `packages/context-gate/src/firewall-ledger.ts`:

```ts
export const firewallEventSchema = z.object({
  at: z.string().datetime(),          // ISO
  kind: z.enum(["blocked-read", "redacted", "observed"]),
  detector: z.string().min(1),        // "secret-path" | pattern name | "email"
  count: z.number().int().positive(), // occurrences in this pipeline pass
  sourcePath: z.string().optional(),  // file path or command label (redacted form)
  projectId: z.string().optional(),
  sessionId: z.string().optional(),
}).strict();

export function appendFirewallEvent(storeRoot: string, ev: FirewallEvent): void
export function firewallLogPath(storeRoot: string): string   // <store>/firewall/events.jsonl
```

- Append-only JSONL, mkdir-on-first-write, one JSON object per line.
- **Best-effort**: any write failure is swallowed — the saver pipeline must
  never fail because auditing failed (mirrors the evidence-ledger posture).
- **Write points** (orchestrator only — `filterOutput` stays pure; the
  redaction result flows out through the filter result):
  - `run.ts` file-read path + `read.ts` (proxy read): `evaluatePathRead`
    deny → one `blocked-read` event (`detector: "secret-path"`, sourcePath =
    the denied path); after filter: one `redacted` event per finding name,
    one `observed` event per observer name (counts aggregated per pass).
  - `run-command.ts` exec path: same redacted/observed mapping for the
    captured output pass.
- Events are emitted regardless of Pro entitlement (free, always on).

### 3. Privacy invariants (security-critical)

- **F-FW-1 (value-free ledger):** no event field may contain matched text,
  masked fragments, lengths, offsets, or any value-derived data beyond the
  detector name and an occurrence count. Enforced by the schema (`.strict()`,
  no value field exists) and by an end-to-end test: run a known card/IBAN/
  TCKN/secret through the full pipeline, then assert `events.jsonl` does not
  contain any digit-run ≥ 6 from the planted values.
- **F-FW-2 (sourcePath hygiene):** `sourcePath` is stored in redacted form
  (`redact(path).redacted`) — matches the existing label convention.
- **F-FW-3 (fail-open pipeline, fail-closed content):** ledger IO failures
  never block the pipeline; redaction itself remains fail-closed as today
  (F-MAJ-3 untouched).

### 4. `@megasaver/pro-analytics` — analyzer (pure)

`packages/pro-analytics/src/firewall-report.ts`:

```ts
export interface FirewallReport {
  windowDays: number;
  events: number;                       // events considered in window
  blockedReads: Array<{ sourcePath: string; count: number }>;   // top N=10 by count
  redactedByDetector: Array<{ detector: string; count: number }>; // desc by count
  observedEmails: number;
  advice: string[];                     // one line per non-empty category
}
export function diagnoseFirewall(
  events: FirewallEventInput[],         // structural type; no context-gate import
  opts: { now: number; days?: number }, // days default 7
): FirewallReport
```

Pure, deterministic, no IO. Advice lines (exact strings pinned in tests):
blocked reads → "the agent attempted to read secret files — review the
prompts/workflows that pointed it there"; redactions → "secrets passed
through tool output — rotate any recently pasted credentials"; PII →
"PII appeared in tool output — check what files/commands expose customer
data"; emails → informational only. No reliability gating (counts are facts,
not estimates — unlike cache-doctor dollars).

### 5. `apps/cli` — `mega firewall` (Pro)

`apps/cli/src/commands/firewall.ts`, mirroring `cache.ts` verbatim in shape:

- Entitlement gate FIRST (`savings-analytics`); free path prints the upsell
  (`FIREWALL_UPSELL`, megasaver.dev/pro), exit 0.
- `--days` parsed at the boundary: integer 1..3650 (cache-doctor lesson —
  unbounded days → Date RangeError), else typed stderr + exit 1.
- `--json`: **always** emits the `FirewallReport` JSON, including the
  no-log / empty-window case (cache-doctor `--json` contract lesson).
- Injected `readFirewallLog(storeRoot): string | null` seam (default reads
  `firewallLogPath`); per-line Zod parse, corrupt lines skipped.
- Prose output: header (`Context firewall — last N days`), counts line,
  per-category sections, advice, and the known-limit footer line
  ("guards the Mega Saver ingress surface; native agent reads bypass it").
- Empty window → "no firewall events recorded — either nothing was blocked
  or Mega Saver Mode is not routing this workspace" + exit 0.
- Registered in `main.ts`; CLI may import `firewallEventSchema` from
  `@megasaver/context-gate` (existing allowed edge) — **no new dependency
  edges** (dependency-graph guard stays green; cache-doctor lesson).

## Error handling

- Ledger write errors: swallowed (F-FW-3).
- Report read: missing file → empty report; corrupt lines → skipped
  (crashed-writer tail must not kill the report); oversized log is fine
  (linear scan, same posture as usage.jsonl).
- Validators: checksum functions never throw on arbitrary digit strings.

## Testing (TDD; the plan pins exact cases)

1. **policy**: Luhn/mod-97/TCKN — valid fires, invalid (checksum-broken)
   does NOT; separators; boundaries (13/19 digits); TCKN leading-zero reject;
   email observed-not-redacted (text unchanged, observed count right);
   existing 16 patterns' behavior unchanged (regression: same `redacted`
   output + `count` on the existing fixture corpus).
2. **firewall-ledger**: append+mkdir; JSONL shape; write-failure swallowed;
   **F-FW-1 end-to-end value-free test** (planted card/IBAN/TCKN/secret →
   no digit-run ≥ 6 in events.jsonl).
3. **context-gate wiring**: blocked-read event on path deny (run.ts +
   read.ts), redacted/observed events on both file and exec paths, event
   counts match the filter result, pipeline result unchanged when the ledger
   writer throws.
4. **pro-analytics**: window filtering (default 7 / custom), top-10 blocked
   list ordering, per-detector ordering, advice string pinning, empty input.
5. **cli**: gate-first (nothing read on free path), invalid + valid `--days`,
   `--json` on no-log/empty/populated (always JSON), prose sections +
   footer, corrupt-line skip, real-fs smoke via `defaultCompressFs`-style
   injected reader + registered-command smoke.

## Definition of Done

Standard §9 chain (HIGH risk): plan → TDD → `pnpm verify` green → CLI smoke
on the real store → code-reviewer AND critic (separate, fresh contexts) →
changeset (`@megasaver/cli` minor → 1.12.0) → README Pro section row + wiki
(`entities/cli` module-10 bullet, `log.md` entries) → PR → squash/rebase per
branch cleanliness → tag `v1.12.0` → auto-publish (no manual npm publish).
