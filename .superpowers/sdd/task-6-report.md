# Task 6 report — official evidence and architecture closure

Status: implementation verified locally; official score not run; fresh independent review pending.

## Architecture correction

- `Lm2BenchmarkContextBuilder` now constructs harness context only from ordered
  public benchmark candidates and the harness token budget.
- The benchmark runtime ranks public projections directly and does not call or
  imitate LM1 capture, correction closure, evidence selection, or product recall.
- A cross-path fixture proves shared candidate semantics while retaining the
  intended policy difference: the benchmark path can return a raw superseded
  projection, while the LM1 selector returns its evidence-valid correction.
- LM1 model, path, and store responsibilities were split behind their existing
  public facades. A source gate covers every production long-memory TypeScript
  file and benchmark script at 300 lines or fewer.

## Official evidence correction

- The standalone verifier executes `evidence-schema.json` and validates safe
  builder names, exact fields, paths, digests, counts, and numeric constraints.
- Each domain memory configuration binds canonical manifest bytes/digest/path,
  pinned data revision, exact transport command and executable digest, and the
  Mega Saver commit. The Python backend validates that commit field too.
- Full verification rebuilds web and enterprise manifests from pinned official
  trajectories, recomputes official per-domain and combined aggregates, derives
  all five latency aggregates from raw harness rows, and cross-binds telemetry
  question IDs and internal latency to the corresponding harness rows.
- Full verification reruns both pinned leaderboard builders with the recorded
  generation timestamps, then byte-compares the complete fresh package,
  overview (including LAFS/reference frontier), and extracted tar contents.
- Inspect and preflight modes remain structurally ineligible. No real completed
  web plus enterprise artifact bundle is available, so this work records no
  official score or dashboard claim.

## Verification evidence

- `pnpm verify`: 56/56 Turbo tasks successful.
- `@megasaver/long-memory`: 42/42 files, 361/361 tests, zero type errors.
- Pinned official-base Python suite: 26 tests passed; one optional built-
  transport test skipped when its environment variable was not configured.
- Evidence integration: 20/20 tests, including schema, unsafe-name, telemetry
  identity/latency, transport substitution, missing-field, and unavailable-full-
  verification failures.
- Pinned official checkout preflight remains ineligible; full qualification was
  not attempted because authoritative released data and completed harness/judge
  artifacts were unavailable.
