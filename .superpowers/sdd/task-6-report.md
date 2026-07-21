# Task 6 report — official evidence and architecture closure

Status: P1 evidence corrections implemented; official score not run; fresh independent review pending.

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
- A fixture loaded from the pinned official checkout proves that
  `combine_timing` emits exactly `avg_seconds`, `max_seconds`, and
  `total_seconds`; combined evidence rejects local p50/p95 additions. Full mode
  calls the pinned four-argument `combine_metrics`, including source paths and
  timestamp provenance, then compares the complete result.
- Executed commands and `run_args.json` must resolve the recorded questions,
  haystack, trajectories, memory config, and output directory, including exact
  reader/judge models. The recorded command prefix is exactly Python plus
  `-m evaluation.harness`; every remaining argument is in the pinned harness
  allowlist, is parsed with its official type/choice/default, and must reproduce
  the complete `run_args.json`. Full mode freshly materializes the complete
  released questions and haystack for both domains, byte-compares them, and
  requires the recorded trajectories to equal the released file.
- Full verification requires a clean Mega Saver checkout at the recorded commit,
  checks adapter/transport bytes against that checkout, performs a fresh package
  build, and compares the rebuilt bytes again.
- Recorded tar members are regular, traversal-safe, streamed, and byte-equal to
  the recorded package. Fresh builders and their tar remain byte-compared too.
- Telemetry must exactly equal official `memory_post_query_metadata`; its
  profile, status, model fingerprint, question type, image flags, candidate and
  selection counts, and latency shape are independently checked against the
  memory config, manifest, question, and returned official context. Each
  telemetry millisecond duration must also fit inside its official harness
  `memory_query_duration_seconds` wall measurement. Raw question and answer text
  are forbidden.
- Combined timing follows the pinned combiner's floating-point operation order:
  web total plus enterprise total, divided by their official question counts,
  with the maximum selected from the two domain summaries. A floating-order
  fixture proves that flattening raw samples would reject authentic bytes.
- Reviewer-generated cache inspection found only
  `test_official_evidence_contract.cpython-311.pyc`; its exact `__pycache__`
  directory was moved recoverably to
  `/tmp/megasaver-task6-reviewer-pycache.J8Sash` before implementation. No
  unrelated path was removed.
- Inspect and preflight modes remain structurally ineligible. No real completed
  web plus enterprise artifact bundle is available, so this work records no
  official score or dashboard claim.

## Verification evidence

- Focused evidence, provenance, and source-size regressions: 47/47 passed.
- Pinned official `combine_timing` fixture against commit
  `6f020ac2fc3275e46c706d3406e02c3ed79b7be2`: 1/1 passed.
- `@megasaver/long-memory`: build passed; typecheck reported zero errors; 43/43
  files and 386/386 tests passed.
- Pinned official-base Python suite with the real built transport: 28/28 passed;
  `compileall` also passed.
- Pinned official checkout preflight passed and returned
  `officialScoreEligible: false`.
- Repository `pnpm verify`: 56/56 Turbo tasks successful, including lint,
  monorepo typecheck/tests, and convention drift checks.
- Full qualification is not attempted without authoritative released data and
  completed harness/judge artifacts.
