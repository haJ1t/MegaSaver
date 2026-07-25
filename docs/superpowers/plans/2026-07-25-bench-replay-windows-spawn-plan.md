# bench-replay windows spawn — plan

Spec: [2026-07-25-bench-replay-windows-spawn-design.md](../specs/2026-07-25-bench-replay-windows-spawn-design.md)

1. Add `test/saver-subprocess-script-bin.test.ts` — a `mega.cjs` fixture with
   no shebang and no exec bit, driven through `prepareSaverStore` and
   `makeSpawnedSaver`.
   → verify: **RED** on POSIX with the same "OS cannot start this file" class
   the win32 job hits.
2. Add `spawnParts` and route both spawn sites through it.
   → verify: the new tests pass; `@megasaver/bench-replay` 149/149.
3. Drop the win32 skip in `saver-subprocess-store-isolation.test.ts` and mirror
   resolveStorePath's win32 branch in its `realStoreRoot()`, so the un-skipped
   test is not vacuous on Windows.
   → verify: still green on POSIX.
4. Spec + plan; `pnpm verify`.
5. Review (`code-reviewer`), then CI on windows-latest as the real proof.
6. Address review findings.

## Review findings addressed

- **The newly un-skipped compression test had a thin timeout.** 60 s cap, and
  the reviewer measured the test at 27 s standalone on a fast machine — a 2.2x
  margin, on the one platform this change exists to turn green, where spawn and
  filesystem work run 2-3x slower. A timeout there would have reproduced the red
  job with a different cause. Raised to 120 s, with the real measurement in the
  comment instead of the stale "~15s" estimate. The neighbouring "smallest
  margin that still compresses" claim was also false at 40 KB; corrected rather
  than tuned, since shrinking the payload would change what the test proves.
- **Spec overclaimed coverage.** "A wrapper on PATH is passed through untouched"
  reads as *that case works*; on Windows a PATH wrapper is exactly what does
  not. `--mega-bin` defaults to `"mega"`, which is `mega.cmd` there, and node
  has refused to `execFile` a `.cmd` without `shell: true` since the
  CVE-2024-27980 patch. Spec now scopes the fix to JS entrypoints and to
  `replay`, and names the `.cmd` and extensionless-shebang cases as unfixed.
- **Stale test name** still said "(never runs on win32)". Removed.

Not acted on: `stdio` noise from the `does-not-exist.mjs` case (cosmetic
`MODULE_NOT_FOUND` stack in CI logs) and `.JS` casing on case-insensitive
filesystems.

## Evidence

Step 1 RED:

```
× enables and reads back the saver through a non-executable .cjs bin
  → prepareSaverStore: could not enable the saver in /var/.../store:
    spawnSync /var/.../mega.cjs EACCES
× runs the hook through a non-executable .cjs bin
  → spawnSync /var/.../mega.cjs EACCES
```

Matches the CI signature (`spawnSync C:\...\mega.cjs EFTYPE`) — same failure,
platform-appropriate errno.

Step 2–6 GREEN: `@megasaver/bench-replay` 149/149 (14 files);
`pnpm verify` 56/56 tasks, exit 0.

Step 5: windows-latest `verify` is the only proof that counts for the original
report — the local RED/GREEN establishes the mechanism, not the platform.
