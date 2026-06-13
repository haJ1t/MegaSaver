# MegaSaver Proxy Mode v1.2 Design Spec

Date: 2026-06-12  
Status: Commit-ready Draft  
Target Release: v1.2  
Scope: Proxy Mode integration over existing Context Gate / Mega Saver Mode

---

## 1. Summary

MegaSaver v1.2 introduces **Proxy Mode** as the public-facing name for token-saving tool-output pruning.

This is **not** a new proxy architecture.

Proxy Mode must evolve the existing:

- Context Gate
- Mega Saver Mode
- output-filter
- content-store
- policy layer
- redaction pipeline
- stats/audit system
- existing `mega_*` MCP tools

into a clearer, more measurable, more agent-friendly feature.

The core product claim:

> Others prune output. MegaSaver prunes with your project’s memory.

---

## 2. Non-Goals

v1.2 must not create a parallel proxy stack.

Do not create duplicate versions of:

- chunk store
- audit tracking
- redaction
- command policy
- output filtering
- retrieval/indexing
- stats/dashboard
- command execution wrapper
- ranking engine
- MCP tool schema set

Specifically, avoid a new `packages/proxy` implementation that duplicates existing modules.

Allowed:

- public naming mode
- thin MCP tool-name adapters
- new compressor modules
- output classifier
- shared ranking adapter
- connector instruction updates
- metrics additions
- hook installer
- tests/fixtures

---

## 3. Existing System Mapping

| Proxy Mode concept | Existing MegaSaver component | v1.2 action |
|---|---|---|
| `proxy_read_file` | `mega_read_file` | Expose through selected naming mode |
| `proxy_run_command` | `mega_run_command` | Expose through selected naming mode |
| `proxy_expand_chunk` | `mega_fetch_chunk` | Expose through selected naming mode |
| chunk storage | content-store | Reuse |
| token audit | stats + audit dashboard | Reuse + extend |
| secret redaction | existing redact pipeline | Reuse |
| command policy | existing policy allowlist | Reuse |
| generic output pruning | Context Gate / Mega Saver Mode | Reuse + improve |
| ranking | current context-pruner / LAMR-style scorer | Extract/share, do not duplicate |
| MCP tool naming | existing `mega_*` names | Add naming mode, do not list both sets by default |

---

## 4. Public Naming

Public product name:

```txt
Proxy Mode
```

Internal names may remain:

```txt
Context Gate
Mega Saver Mode
Output Filter
Content Store
```

Public one-liner:

```txt
Others prune output. MegaSaver prunes with your project’s memory.
```

Avoid using competitor-specific language such as “DFMT-style” in public README headings.

Category comparison is okay:

```txt
Generic output filters prune text.
MegaSaver prunes with project memory.
```

---

## 5. MCP Tool Naming Mode

### 5.1 Problem

MCP does not have a true alias concept.

If MegaSaver lists both:

```txt
mega_read_file
proxy_read_file
mega_run_command
proxy_run_command
mega_fetch_chunk
proxy_expand_chunk
```

then:

- MCP tool count increases
- tool schemas consume more context
- the agent may become uncertain which tool to use
- a token-saving product wastes tokens through duplicate tool schemas
- connector behavior becomes less predictable

Therefore, v1.2 must not list both naming sets by default.

### 5.2 Decision

Add a tool naming mode:

```txt
MEGASAVER_TOOL_NAMING=proxy|legacy
```

Default:

```txt
proxy
```

Behavior:

```txt
proxy mode:
    MCP tools/list exposes proxy_* names only for affected tools.

legacy mode:
    MCP tools/list exposes existing mega_* names only.

internal:
    both naming modes call the same underlying implementation.
```

### 5.3 Tool Name Mapping

| Proxy mode name | Legacy mode name | Implementation |
|---|---|---|
| `proxy_read_file` | `mega_read_file` | existing read-file implementation |
| `proxy_run_command` | `mega_run_command` | existing command implementation |
| `proxy_expand_chunk` | `mega_fetch_chunk` | existing chunk fetch implementation |
| `proxy_stats` | existing stats/audit entry point | existing stats/audit implementation |
| `proxy_search_code` | new | new v1.2 tool |

### 5.4 Acceptance Criteria

- default MCP tool list exposes proxy names, not duplicate proxy + legacy names
- legacy mode remains available for existing connector installs
- no duplicated schema entries for the same underlying tool
- connector docs explain how to use legacy mode
- changing naming mode does not change behavior, only exposed names
- PR 1 implements this because changing it later would break connectors

---

## 6. MCP Reality: Opt-In, Not True MITM

Proxy Mode over MCP is not a true man-in-the-middle proxy.

The agent must choose:

- `proxy_read_file` instead of native Read
- `proxy_run_command` instead of native Bash/shell
- `proxy_search_code` instead of native grep/search
- `proxy_expand_chunk` to retrieve omitted context

Therefore, connector instruction blocks and MCP tool descriptions are part of the product.

v1.2 must strongly bias agents toward proxy tools.

---

## 7. Metrics Correction: Interception vs Adoption

### 7.1 Problem

MCP server cannot see native agent tool calls by default.

So this metric cannot be universally measured:

```txt
native Read/Bash/Grep calls made outside MegaSaver
```

Therefore, a universal “interception rate” denominator is not available.

### 7.2 Correct Metrics

Use two metric modes.

#### A. Proxy Adoption Rate

Available for all agents.

```txt
proxy_adoption = proxy_tool_calls / known_megasaver_tool_calls
```

Also report:

- proxy call count
- proxy calls by type
- expand rate
- token savings from proxy-mediated calls
- raw stored output count
- average compression ratio

This is honest and universally measurable.

#### B. Hook-Based Interception Rate

Available only for connectors where native tool calls can be observed.

For Claude Code, use hooks.

Example:

```txt
Claude Code PreToolUse hook logs native Read/Bash/Grep tool-call metadata
MegaSaver reads the hook log
MegaSaver computes proxy vs native eligible calls
```

Then:

```txt
interception_rate = proxy_tool_calls / eligible_native_plus_proxy_calls
```

### 7.3 v1.2 Requirement

v1.2 should implement:

- proxy adoption rate for all connectors
- hook-based interception rate only for Claude Code if hook logging is installed and available
- clear audit wording so users understand the difference

Do not claim universal interception rate without hook data.

---

## 8. Ranking Architecture Correction

### 8.1 Problem

Do not create a second ranking engine inside output-filter.

MegaSaver already has LAMR-style task-aware scoring in the context-pruning layer.

A second additive formula inside Proxy Mode would create:

- duplicate scoring logic
- inconsistent explanations
- different ranking behavior between context packs and output filtering
- higher maintenance cost

### 8.2 Correct Approach

Extract or expose the existing context-pruner scorer as a shared ranking service.

Suggested package/module:

```txt
packages/ranking-core
```

or existing module refactor:

```txt
packages/context-pruner/scoring
```

Proxy Mode should call the shared scorer.

### 8.3 v1.2 Ranking Scope

Keep v1.2 ranking intentionally small.

Use existing BM25/output matching plus only:

- memory boost
- failure history boost

Move these signals to v1.3:

- repo index signal
- dependency support
- recent-edit signal
- rule efficacy
- full LAMR multi-signal scoring

### 8.4 Normalization Requirement

All signals must be normalized to a common range before combination.

Example:

```txt
0.0 <= signal <= 1.0
```

Initial formula:

```txt
final_score =
    0.70 * base_output_relevance
  + 0.15 * memory_boost
  + 0.15 * failure_history_boost
```

This must be behind a feature flag:

```txt
MEGASAVER_ENGINE_RANKING=true
```

Acceptance criteria:

- feature flag can disable engine-aware ranking
- scores are normalized
- ranking explanations show which signals contributed
- output-filter uses shared scoring logic, not a duplicate scorer

---

## 9. proxy_search_code Backend Decision

### 9.1 Problem

`proxy_search_code` has two possible backends:

1. live policy-gated `rg` execution
2. semantic index / BM25 block search

They behave differently.

Index search is richer but can fail or mislead when:

- `mega index build` has not been run
- the index is stale
- generated files changed
- files were edited after indexing
- the repo is new or partially indexed

### 9.2 v1.2 Decision

Use live `rg` execution as the primary backend.

Use semantic index only as enrichment.

v1.2 behavior:

```txt
1. Run policy-gated rg/search over current filesystem.
2. Store raw search output in content-store.
3. Group matches by file.
4. Rank and compress matches.
5. If index exists and is fresh enough:
       enrich results with block names, related symbols, and related tests.
   Else:
       continue without index enrichment.
```

### 9.3 Stale or Missing Index Behavior

If index is missing:

```txt
proxy_search_code works normally using rg.
Response includes: index_enrichment = unavailable.
```

If index is stale:

```txt
proxy_search_code works normally using rg.
Response includes: index_enrichment = skipped_stale_index.
Optional suggestion: run mega index build.
```

Do not block search because of missing or stale index.

### 9.4 v1.3 Direction

v1.3 may add index-first or hybrid search modes:

```txt
search_backend=rg|index|hybrid
```

But v1.2 default must be reliable without indexing.

### 9.5 Acceptance Criteria

- works without index
- works with stale index
- live filesystem results are source of truth
- index enrichment never overrides live matches
- index enrichment is clearly marked in output/audit
- raw rg output is stored and expandable
- search execution respects existing command policy

---

## 10. Output Classifier Requirement

### 10.1 Problem

Compressor dispatch requires knowing what kind of output was produced.

A compressor interface alone is not enough.

Proxy Mode must classify command output before compression.

### 10.2 ANSI Normalization Requirement

Real terminal output often contains ANSI escape codes.

Examples:

- `tsc --pretty`
- Vitest default reporter
- colored stack traces
- CI logs with color enabled

Classification and compression must run after ANSI stripping.

Required pipeline:

```txt
raw stdout/stderr
  ↓
store raw output unchanged in content-store
  ↓
strip ANSI for classification/compression
  ↓
classify
  ↓
compress normalized output
  ↓
return compact output
```

Raw output must remain available for expansion.

### 10.3 Classifier Inputs

Use both:

1. Command matching
2. Output sniffing

Command matching examples:

```txt
vitest
npm test
pnpm test
yarn test
tsc
tsc --noEmit
npm run typecheck
pnpm typecheck
```

Output sniffing examples after ANSI strip:

```txt
Vitest:
- "FAIL"
- "Test Files"
- "Tests"
- "Duration"
- "AssertionError"
- "Serialized Error"

TypeScript:
- "error TS"
- ".ts("
- ".tsx("
- "Found X errors"
```

### 10.4 Output Categories

v1.2 categories:

```txt
vitest
typescript
generic_shell
unknown
```

v1.3 categories:

```txt
eslint
jest
playwright
next_build
git_diff
git_status
build_log
generic_log
```

### 10.5 Fixture Requirements

Fixtures must include:

- plain Vitest output
- ANSI-colored Vitest output
- Vitest default reporter
- Vitest verbose reporter
- at least two Vitest version/output variants if available
- plain tsc output
- ANSI-colored `tsc --pretty` output
- mixed stdout/stderr command output
- unknown command output

### 10.6 Acceptance Criteria

- ANSI strip happens before classification and compression
- raw ANSI output remains stored for expansion
- classifier exists before compressor dispatch
- classifier has fixture tests
- classifier returns confidence
- low-confidence classification falls back to generic output filter
- command metadata and output sniffing are both used

---

## 11. Small Output Passthrough Rule

### 11.1 Problem

A full Proxy Mode response wrapper can cost hundreds of tokens.

For small outputs, wrapping may create negative savings.

### 11.2 Rule

If raw output is below threshold, return minimal passthrough.

Suggested defaults:

```txt
passthrough_threshold_tokens = 1200
hard_wrap_threshold_tokens = 2000
```

Behavior:

```txt
if raw_tokens < 1200:
    return minimal passthrough

if 1200 <= raw_tokens < 2000:
    return light summary + raw output

if raw_tokens >= 2000:
    run full Proxy Mode compression
```

### 11.3 Minimal Passthrough Format

```txt
MEGASAVER_PROXY_PASSTHROUGH

Output below compression threshold.
Raw tokens: 430
Compression skipped to avoid negative savings.

<raw output>
```

### 11.4 Acceptance Criteria

- small outputs are not over-wrapped
- audit records “passthrough”
- token savings does not report fake positive savings
- user can configure threshold

---

## 12. Replay Trace for Future Benchmarks and Ablations

### 12.1 Problem

v1.4 benchmark and ablation work should not rely only on synthetic fixtures.

If v1.2 records the right traces now, v1.4 can replay real sessions and compare ranking variants cheaply.

### 12.2 Required Trace

Every compressed proxy response should record a replay trace.

Trace should include:

- session ID
- project ID
- task text if provided
- tool name
- command or file/search query
- classifier result
- classifier confidence
- raw token estimate
- returned token estimate
- candidate chunks/excerpts
- selected chunks/excerpts
- omitted chunks/excerpts
- signal values used for ranking
- final scores
- ranking mode / feature flags
- compressor used
- passthrough/compressed decision
- expand events linked later if user/agent expands

### 12.3 Privacy/Safety

Do not log additional raw contents beyond what content-store already stores.

The replay trace should reference content IDs/chunk IDs, not duplicate full raw outputs.

### 12.4 Acceptance Criteria

- replay trace is written for compressed proxy responses
- trace is written for passthrough decisions with minimal metadata
- trace references content-store IDs
- trace captures enough data to replay ranking offline
- trace supports v1.4 ablations:
  - generic output filter baseline
  - + memory boost
  - + failure history boost
  - + repo index signal
  - + dependency signal
  - full engine-aware ranking

---

## 13. Claude Code Hook-Based Interception Measurement

### 13.1 Goal

Measure native tool calls that bypass Proxy Mode in Claude Code.

### 13.2 Installer Requirement

Add a hook installer command:

```txt
mega hooks install claude-code
```

This should integrate with existing setup flows:

```txt
mega mcp install claude
Agent Setup Doctor
GUI Agent Setup Doctor
```

The installer should add a Claude Code `PreToolUse` hook entry where supported.

### 13.3 Hook Behavior

The hook must log native metadata for:

```txt
Read
Bash
Grep
Glob
LS
```

Write to:

```txt
.megasaver/hooks/claude-tool-calls.jsonl
```

Example log entry:

```json
{
  "timestamp": "2026-06-12T15:21:00.000Z",
  "agent": "claude-code",
  "tool": "Read",
  "category": "eligible_read",
  "filePath": "src/auth.ts",
  "sessionId": "abc123"
}
```

### 13.4 Hook Safety Rules

The hook script must be:

- fast
- non-blocking
- metadata-only
- best-effort
- always exit 0
- safe if `.megasaver` does not exist
- safe if log file cannot be written
- never log raw file contents
- never block the user’s tool call

Critical rule:

```txt
The hook logger must never prevent the original tool from running.
```

### 13.5 Metric Calculation

MegaSaver reads this hook log and computes:

```txt
hook_interception_rate =
  proxy_eligible_calls / (proxy_eligible_calls + native_eligible_calls_from_hook)
```

### 13.6 Missing Hook Behavior

If no hook file exists, do not show interception rate.

Show:

```txt
Proxy adoption metrics only.
Claude Code hook telemetry not configured.
Run: mega hooks install claude-code
```

### 13.7 Acceptance Criteria

- hook installer exists
- hook logging is optional
- missing hook log does not break stats
- hook script always exits 0
- only metadata is logged
- metric wording is explicit
- setup doctor can detect whether hook telemetry is installed

---

## 14. v1.2 Deliverables

### Deliverable 1 — MCP Tool Naming Mode

Add:

```txt
MEGASAVER_TOOL_NAMING=proxy|legacy
```

Default:

```txt
proxy
```

Acceptance criteria:

- default MCP tool list exposes proxy names only for renamed tools
- legacy mode exposes old `mega_*` names only
- both modes call same implementation
- no duplicate proxy + legacy schema listing
- connector docs explain naming mode
- existing installations can opt into legacy mode

---

### Deliverable 2 — Output Classifier

Add classifier before compressor dispatch.

Inputs:

- command string
- exit code
- stdout
- stderr
- file path if applicable
- tool type

v1.2 classifications:

```txt
vitest
typescript
generic_shell
unknown
```

Acceptance criteria:

- ANSI is stripped before classification
- Vitest fixtures classified correctly
- tsc fixtures classified correctly
- colored output fixtures classified correctly
- unknown output falls back safely
- classifier confidence is recorded
- classifier result appears in debug/audit mode

---

### Deliverable 3 — Vitest Compressor

Compress Vitest output.

Keep:

- failing test names
- assertion messages
- stack traces
- relevant file paths
- line numbers
- test summary
- exit code

Collapse:

- passing tests
- repeated logs
- duplicate stack frames
- long snapshots unless failing
- irrelevant warnings

Acceptance criteria:

- raw output stored in content-store
- ANSI-normalized output used for compression
- compressed output keeps actionable failure details
- exit code preserved
- expandable chunks available
- token savings measured
- small outputs passthrough

---

### Deliverable 4 — TypeScript Compressor

Compress `tsc` output.

Keep:

- file path
- line/column
- TS error code
- main message
- grouped related errors
- top files by error count

Collapse:

- repeated cascading errors
- huge generic expansions
- duplicates

Acceptance criteria:

- raw output stored
- ANSI-normalized output used for compression
- grouped compiler errors returned
- full output expandable
- exit code preserved
- token savings measured
- small outputs passthrough

---

### Deliverable 5 — proxy_search_code

New tool.

Purpose:

```txt
Task-aware code search that groups, ranks, compresses, and stores noisy search output.
```

Backend:

```txt
v1.2 primary backend = policy-gated rg execution
index = optional enrichment only
```

Inputs:

```txt
query
task
path_scope
max_results
max_tokens
include_globs
exclude_globs
context_lines
```

Output:

- grouped matches by file
- relevant snippets
- reason per included file
- omitted low-value matches
- optional index enrichment
- expandable chunk IDs
- token savings estimate

Acceptance criteria:

- works without index
- works with stale index
- live rg/filesystem results are source of truth
- stale/missing index does not fail tool
- index enrichment is marked when used/skipped
- results grouped by file
- noisy matches collapsed
- task relevance used
- raw search results stored
- output expandable
- metrics recorded

---

### Deliverable 6 — Narrow Engine-Aware Ranking

Feature flag:

```txt
MEGASAVER_ENGINE_RANKING=true
```

v1.2 signals only:

```txt
base output relevance
memory boost
failure history boost
```

Do not include full index/dependency/recent-edit signals in v1.2.

Acceptance criteria:

- shared scorer is reused or extracted
- no second ranking engine created
- signal values normalized
- ranking explanation available
- feature flag can disable behavior
- replay trace records candidate scores and selected chunks

---

### Deliverable 7 — Proxy Metrics

Universal metrics:

- proxy adoption rate
- proxy call count
- proxy calls by type
- expand rate
- raw tokens
- returned tokens
- saved percentage
- passthrough count
- classifier category count
- compressor usage count

Claude Code hook metrics if available:

- native eligible calls
- proxy eligible calls
- hook-based interception rate

Acceptance criteria:

- proxy_stats shows universal metrics
- hook-based metrics only appear when hook log exists
- audit wording does not overclaim
- dashboard separates adoption from interception
- missing hook shows install suggestion

---

### Deliverable 8 — Connector Instructions

Update connector instructions.

Instruction principle:

```txt
Prefer proxy_* tools for reading files, searching code, running tests, running typecheck, inspecting build logs, and reviewing diffs.
Use native tools only when explicitly required.
Expand chunks before assuming omitted content is irrelevant.
```

Acceptance criteria:

- Claude Code instruction block updated
- Cursor instruction block updated if supported
- Codex/Gemini/Aider docs updated if present
- MCP tool descriptions are agent-friendly
- README explains Proxy Mode is opt-in
- README avoids competitor-specific “DFMT-style” headline

---

### Deliverable 9 — Hook Installer

Add:

```txt
mega hooks install claude-code
```

Acceptance criteria:

- installs Claude Code PreToolUse telemetry hook where supported
- hook logs metadata only
- hook always exits 0
- setup doctor detects installed/missing hook
- stats uses hook only when present
- no raw file contents are logged

---

### Deliverable 10 — Replay Trace

Add replay trace recording for proxy outputs.

Acceptance criteria:

- records task, candidates, signal values, selected chunks, omitted chunks
- references content-store IDs
- supports offline replay
- supports v1.4 ablations
- does not duplicate raw output contents unnecessarily

---

## 15. Recommended PR Order

### PR 1 — MCP Tool Naming Mode

Scope:

- `MEGASAVER_TOOL_NAMING=proxy|legacy`
- default proxy mode
- legacy compatibility
- no duplicate tool schemas
- connector docs updated for naming mode

Why first:

- this affects public MCP schema
- changing later may break connectors
- prevents token waste from duplicate tools

Estimated size:

```txt
small-medium
```

---

### PR 2 — Output Classifier + ANSI Normalization + Fixture Tests

Scope:

- ANSI strip step
- classifier module
- Vitest fixtures
- tsc fixtures
- colored output fixtures
- fallback behavior
- debug/audit classifier metadata

Why second:

- compressor dispatch depends on it

Estimated size:

```txt
medium
```

---

### PR 3 — Vitest and tsc Compressors

Scope:

- compressor interface
- Vitest compressor
- TypeScript compressor
- passthrough threshold
- raw output storage reuse
- token savings

Why third:

- demo heart
- immediate visible savings

Estimated size:

```txt
medium-large
```

---

### PR 4 — proxy_search_code

Scope:

- new MCP tool
- rg-first backend
- grouped/ranked code search
- optional index enrichment
- stale/missing index handling
- chunk storage reuse
- expandable results
- token metrics

Why fourth:

- genuinely new capability
- high-value search-output savings

Estimated size:

```txt
medium-large
```

---

### PR 5 — Narrow Engine-Aware Ranking

Scope:

- shared scorer/extractor
- memory boost
- failure history boost
- feature flag
- normalized scores
- ranking explanations
- replay trace score recording

Why fifth:

- strongest differentiator
- safer after basic proxy tools work

Estimated size:

```txt
medium
```

---

### PR 6 — Hook Installer + Metrics + Connector Instructions

Scope:

- `mega hooks install claude-code`
- proxy adoption metrics
- optional Claude Code hook ingestion
- dashboard cards
- connector instruction updates
- README demo

Why sixth:

- makes savings measurable
- improves actual agent usage

Estimated size:

```txt
medium
```

---

### PR 7 — Replay Trace Hardening

Scope:

- replay trace schema
- content-store references
- expand event linking
- offline replay preparation

Why seventh:

- prepares v1.4 benchmark and ablations
- can be hardened after compressors/ranking exist

Estimated size:

```txt
medium
```

---

## 16. v1.2 Acceptance Criteria

v1.2 is complete when:

- MCP naming mode exists and defaults to proxy names
- legacy mode exposes old `mega_*` names without duplicate proxy names
- `proxy_search_code` exists as a new tool
- `proxy_search_code` uses rg-first backend and works without index
- output classifier exists with Vitest and tsc fixtures
- ANSI strip happens before classification/compression
- Vitest compressor works
- TypeScript compressor works
- small output passthrough works
- raw output storage reuses content-store
- policy reuses existing allowlist
- engine-aware ranking exists behind feature flag with only memory/failure boosts
- ranking logic does not duplicate LAMR/context-pruner scoring
- proxy metrics distinguish adoption from hook-based interception
- Claude Code hook installer exists or is explicitly documented as not yet available
- connector instructions prefer proxy tools
- README avoids competitor-specific “DFMT-style” headline
- replay traces are recorded for future v1.4 ablations

---

## 17. v1.3 Preview

v1.3 should expand v1.2 into production-grade Proxy Mode.

Move these from v1.2 to v1.3:

- repo index ranking signal
- dependency support signal
- recent edit signal
- project rule signal beyond basic failure history
- ESLint compressor
- git diff compressor
- Next.js build compressor
- Jest/Playwright compressors
- rich expand policies
- auto budget
- connector-specific adoption optimization
- optional index-first or hybrid `proxy_search_code` backend

---

## 18. v1.4 Preview

v1.4 should prove the product.

Main themes:

- benchmark harness
- public benchmark report
- ablations
- Proof-of-Done
- proof-aware memory writes

Required ablations:

```txt
baseline generic output filter
+ memory boost
+ failure history boost
+ repo index signal
+ dependency signal
+ full engine-aware ranking
```

Metrics:

- token reduction
- recall of relevant lines
- precision of included excerpts
- omitted-critical-info rate
- expand rate
- task success impact
- latency overhead
- proxy adoption / hook-based interception

Replay traces from v1.2 should make these ablations cheap to run on real recorded sessions.

---

## 19. Final Product Message

Use this externally:

```txt
Others prune output. MegaSaver prunes with your project’s memory.
```

Longer version:

```txt
MegaSaver Proxy Mode reduces token-heavy tool outputs from coding agents by returning task-aware summaries, relevant excerpts, expandable chunks, and savings metrics.

Unlike generic output filters, it uses your project’s structured memory, previous failures, and coding context to decide what matters.
```

Do not lead with niche competitor names.

---

## 20. Final Engineering Rule

The most important rule for v1.2:

```txt
Evolve Context Gate. Do not rebuild it.
```

The most important schema rule:

```txt
Do not list duplicate proxy and legacy tool names in MCP by default.
```

The most important differentiator:

```txt
Memory-aware output pruning.
```

The most important proof:

```txt
Ablation benchmark showing memory-aware ranking beats generic output filtering.
```
