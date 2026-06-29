---
title: Structured-data Schematizer (compressJson)
status: approved
risk: medium
created: 2026-06-29
---

## Goal

Add a `structured` output category and a `compressJson` compressor to
`@megasaver/output-filter`. Large homogeneous JSON arrays (API list payloads,
lockfile dependency arrays, `jq`-piped records) are dominated by repetition:
every element shares the same shape, so the schema plus a handful of sample
rows carries the signal. Collapsing such an array to its inferred schema plus a
few verbatim rows returns ~95% fewer tokens to the agent (a 5000-line
homogeneous JSON array → schema + ~4 sample rows) while every element stays
recoverable.

The compressor must stay tool-resident: it runs inside the same
`compressByCategory` pipeline used by the CLI saver hook AND the MCP tools
(`mega_run_command` / `mega_read_file`), so the feature works on Claude Desktop
via MCP with no extra wiring.

## Mechanism

(Locked design — formalised, not redesigned.)

**Classification.** Add `structured` to the `OutputCategory` enum. It fires
when ANY of:

- the content `JSON.parse`s to an array or object, OR
- the read path matches `*.json` / `package-lock.json` / `pnpm-lock.yaml`, OR
- the command is `curl` / `cat *.json` / `jq`.

Extend `isConfidentClassification` so `structured` is treated as a confident
classification.

**Guarded compression — array-collapse path only.** `compressJson` only
transforms when `JSON.parse` yields an **array of objects with > N entries**
(N = 20). Otherwise it returns the input unchanged (fall-through). When it
fires, the body is replaced with:

1. The **inferred schema** — the key list with value types, sampled from the
   first K elements.
2. The **first 3 and last 1 elements** verbatim.
3. A marker `… [M more of same shape]` where M is the count of omitted
   elements.

**Intent force-keep.** Any key matching the existing intent signal
(`ClassifyInput.intent`) is retained verbatim in the schema/output — intent
keys are never abstracted into a type-only schema entry.

**Sniff guard.** The collapse path fires ONLY on a large homogeneous array of
objects. Small arrays (≤ N), heterogeneous arrays, and non-array JSON
(objects, scalars) fall through to existing behaviour untouched.

## Files to touch

| File | Change |
|------|--------|
| `packages/output-filter/src/classify.ts` | Add `structured` to enum; add content/path/command sniffers; extend `isConfidentClassification` |
| `packages/output-filter/src/compress/json.ts` | New `compressJson` compressor (array-collapse path) |
| `packages/output-filter/src/compress/index.ts` | Dispatch `structured` → `compressJson` in `compressByCategory`; add `"json"` to `CompressorName` |
| `packages/output-filter/test/...` | Unit tests per Test plan |

## Lossless / evidence-preservation

- **Lossless** — raw output already persists to a ChunkSet before compression;
  `compressJson` only changes what is RETURNED, never what is recoverable. The
  full array stays expandable via `mega_fetch_chunk`.
- **Deterministic** — no LLM calls. Pure parse + schema inference + slice.
- **Evidence-preserving** — collapse applies ONLY to a homogeneous array of the
  same shape. No two distinct errors, diagnostics, or non-conforming elements
  are ever merged or hidden; heterogeneous input falls through rather than
  forcing a lossy schema.

## Test plan

1. **Large homogeneous array** — an array of objects with > N entries collapses
   to inferred schema + first 3 + last 1 elements verbatim + `… [M more of
   same shape]` with the correct M.
2. **Small array** — an array with < N entries falls through unchanged.
3. **Non-array / heterogeneous** — a JSON object, a scalar, or an array of
   mixed shapes falls through unchanged.
4. **Intent force-keep** — when an intent keyword matches an element key, that
   key is retained verbatim in the output rather than reduced to a type.
5. **Malformed JSON** — input that fails `JSON.parse` falls through with no
   throw.

## Out of scope

- Nested-config elision (deferred).
- Object/scalar JSON compression — only the array-collapse path ships.
- Configurable N / K / sample-window — fixed for v1.
- Any change to ChunkSet persistence or `mega_fetch_chunk`.
