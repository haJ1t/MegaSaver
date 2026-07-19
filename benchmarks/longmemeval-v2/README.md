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
