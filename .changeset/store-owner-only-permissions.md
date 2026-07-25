---
"@megasaver/content-store": patch
"@megasaver/evidence-ledger": patch
"@megasaver/output-filter": patch
"@megasaver/stats": patch
"@megasaver/core": patch
"@megasaver/cli": patch
---

Write the store owner-only (dirs 0700, files 0600). Everything MegaSaver
persists was created with process-default permissions — 0644 files inside 0755
directories — so on a shared box every other local account could read it with
`cat` (CWE-732).

The exposed data is the sensitive half of the product: an `OverlayChunkSet`
holds the verbatim body of every file the agent read and the full transcript of
every command it ran (redacted only for known secret shapes), and
`stats/<wk>/session-intent.json` holds the user's verbatim prompt. Both are
written on the default install path — the `mega hooks install` UserPromptSubmit
and PostToolUse hooks — with no exploit step beyond `ls -l`.

Measured on a fresh `HOME` through the real hook entry point
(`… | mega hooks intent`), before → after:

```
drwxr-xr-x  <HOME>/.local/share/megasaver           drwx------
drwxr-xr-x  …/megasaver/stats/<wk>                  drwx------
-rw-r--r--  …/<wk>/session-intent.json              -rw-------
-rw-r--r--  …/<wk>/intent/sess1.json                -rw-------
```

and through `mega output file <session> big.txt --intent …`, every one of
`content/<proj>/<sess>/{<chunkSetId>,read-index,shown-index}.json`,
`stats/<proj>/<sess>{.json,.events.jsonl}` and
`stats/<proj>/<sess>-traces/replay-traces.jsonl` moved from `-rw-r--r--` to
`-rw-------`, with every containing directory from `drwxr-xr-x` to `drwx------`.

Fixed at the writers rather than at one directory, matching the convention the
already-hardened siblings use (`daemon/discovery.ts`, `llm-proxy/store.ts`,
`context-gate/saver-store.ts`): the three `atomicWriteFile` helpers
(content-store, stats, evidence-ledger), the seven stats JSONL appenders (now
routed through one `appendPrivateLine`), `writeReplayTrace`, the CLI intent
hook's `writeIntentAt`, and `initStore` for the store root itself.

Each site pairs the create-time `mode` with an explicit `chmod`, which is what
actually repairs an existing install: `mkdir`'s mode is a no-op on a directory
that already exists and `appendFileSync`'s is ignored once the file exists. That
gap is why the hardened writers were being defeated in practice — an unhardened
writer usually created `stats/` first, leaving `saver-hook-heartbeats.json`
(0600) sitting in a 0755 directory. On the next write, an old store now heals
itself.

Windows is unaffected (NTFS ignores POSIX mode bits); the permission assertions
skip there.
