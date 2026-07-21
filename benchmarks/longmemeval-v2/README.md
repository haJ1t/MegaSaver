# Mega Saver LongMemEval-V2 adapter

`megasaver_memory.py` is a development-only adapter between the public
LongMemEval-V2 harness and Mega Saver's local LM0 JSONL host. It never reads or
writes a Mega Saver user memory store.

The adapter accepts the official trajectory forms: `id` plus either
`states[*].accessibility_tree`/`states[*].text` or
`content[*].observation.text`. Each state is deterministically bounded to
50,000 characters before it crosses the JSONL boundary; its idempotency digest
is calculated from canonical structured JSON of the full source state.

## Public data setup

Download and prepare the benchmark data with the official LongMemEval-V2
instructions. Set `data_root` to the resolved, public benchmark-data directory;
the adapter derives an isolated workspace key from that path. The adapter only
accepts image paths that exist beneath this directory.

Build Mega Saver and prepare a LongMemEval-V2 checkout:

```bash
pnpm --filter @megasaver/long-memory build
export LME_ROOT=/absolute/path/to/LongMemEval-V2
cp benchmarks/longmemeval-v2/megasaver_memory.py "$LME_ROOT/memory_modules/"
```

Add this import to the LongMemEval-V2 checkout's `memory_modules/memory.py` so
the backend is registered:

```python
from .megasaver_memory import MegaSaverLongMemory
```

Create `megasaver-memory.json` in that checkout:

```json
{
  "memory_type": "megasaver_long_memory",
  "memory_params": {
    "data_root": "/absolute/path/to/longmemeval-v2-data",
    "node_command": "node /absolute/path/to/MegaSaver/packages/long-memory/dist/stdio.js",
    "token_budget": 2000,
    "rpc_timeout_seconds": 30
  }
}
```

`rpc_timeout_seconds` bounds one local JSONL request. A timeout closes the
child process rather than waiting indefinitely; construct a fresh memory
instance before issuing another request.

Run the official harness with its public-data root and this configuration:

```bash
python evaluation/harness.py \
  --data-root /absolute/path/to/longmemeval-v2-data \
  --memory-config-path megasaver-memory.json
```

Keep the harness output directory, its `aggregated_metrics.json`, the memory
config, and the Mega Saver commit SHA for each run. Do not retain or submit
non-public trajectory data.

## LM2 hybrid backend

`megasaver_lm2_hybrid.py` is a separate, public-data-only LM2 backend. It does
not extend LM0 stdio and it never opens a production Mega Saver workspace. Each
`open`, `insert`, and `query` operation launches the dedicated
`megasaver-long-memory-lm2-benchmark` executable and waits for it to exit.
Process startup is therefore included in query latency.

The integration is pinned to official LongMemEval-V2 commit
`6f020ac2fc3275e46c706d3406e02c3ed79b7be2` and dataset revision
`f152293e235517d504809563c833d7190b8c713b`. Prepare a checkout and the exact
released data, then build Mega Saver:

```bash
git -C "$LME_ROOT" checkout 6f020ac2fc3275e46c706d3406e02c3ed79b7be2
pnpm --filter @megasaver/long-memory build
mkdir -m 700 /absolute/path/to/private-megasaver-lm2-cache
```

Build one domain/tier manifest. The builder recomputes the released SHA-256
checksums and runs the pinned official `data/validate_data.py` before creating
a new mode-`0600` manifest:

```bash
node benchmarks/longmemeval-v2/build-lm2-manifest.mjs \
  --official-root "$LME_ROOT" \
  --data-root "$DATA_ROOT" \
  --domain web \
  --tier small \
  --output /absolute/path/to/megasaver-lm2-manifest-v1.json
```

The command prints the independently configured `manifestDigest`. Copy
`megasaver_lm2_hybrid.json`, replace its absolute paths, manifest digest, and
`megasaver_commit` with the exact 40-character commit that built the transport, and keep
`embedding_egress` and the model provider set to `local`. Remote endpoints,
remote acknowledgements, and destination fields are rejected.

Install the backend without hand-editing the official checkout:

```bash
node benchmarks/longmemeval-v2/install-lm2-backend.mjs \
  --checkout "$LME_ROOT" \
  --backend "$(pwd)/benchmarks/longmemeval-v2/megasaver_lm2_hybrid.py"
```

The installer accepts only a pristine pinned checkout or its own exact prior
installation. It verifies `memory.py`, the harness, and both leaderboard
builders, then permits only the marked `memory.py` import and backend file.
Re-running it is idempotent and emits pre/post hash evidence.

Run the unmodified official harness with its documented web/enterprise inputs
and the generated memory config. Query admission uses only `question_id`; the
backend discards `question_item`, ignores query images, and returns no image
context. Save/load succeeds only from the original save directory identity.

No LongMemEval-V2 accuracy, latency, LAFS, or leaderboard score is claimed by
these files. Such a claim requires completed web and enterprise runs plus the
official artifact gate implemented separately from this Task 5 transport.

## Official evidence qualification

Inspection authenticates a recorded bundle but is deliberately ineligible for
an official score:

```bash
node benchmarks/longmemeval-v2/verify-official-artifacts.mjs \
  --inspect \
  --evidence /absolute/path/to/evidence.json
```

Only full verification can emit `officialScoreEligible: true`. It requires the
pinned installed checkout and released public data, executes the evidence JSON
Schema, reruns the official data validator and aggregate/combined-metric code,
and requires the pinned combiner's exact three-field combined timing contract.
It freshly materializes every released question and haystack row for both
domains, byte-compares the released trajectory file, and binds those paths plus
reader/judge models in both the executed command and `run_args.json`. The run
must invoke exactly `python -m evaluation.harness`; only pinned harness flags
are accepted, and their official types, choices, defaults, and complete parsed
`run_args.json` must agree. Integer flags use canonical signed decimal lexemes;
exponent, decimal-point, and whitespace forms are rejected before conversion.
Combined timing is reconstructed from web then
enterprise domain totals/counts/maxima, preserving the pinned floating-point
operation order. It also rebuilds both manifests, requires a clean Mega Saver
checkout at the recorded
commit, rebuilds and byte-compares the adapter and transport, maps telemetry
exactly to official per-question metadata, and validates its public fields
against the config and manifest. Telemetry milliseconds cannot exceed the
corresponding official harness query-wall seconds. Per-question evaluator spec,
category, and question text must match the released runtime question, while the
complete judge model/endpoint/reasoning/token/timeout configuration must match
the executed harness. Finally, it deterministically reruns both official
leaderboard builders, validates every tar directory and file path/type before
inventory filtering, and byte-compares the recorded package, streamed tar
members, fresh package, overview/LAFS, extracted fresh tar, and the fresh versus
recorded tar digest:

```bash
pnpm --filter @megasaver/long-memory build
node benchmarks/longmemeval-v2/verify-official-artifacts.mjs \
  --evidence /absolute/path/to/evidence.json \
  --official-root "$LME_ROOT" \
  --data-root "$DATA_ROOT" \
  --python /absolute/path/to/python3.11
```

The verifier does not turn locally fabricated fixtures into benchmark results.
Without real completed web and enterprise harness artifacts, it fails closed
and no score, dashboard, latency, or LAFS claim is valid.
