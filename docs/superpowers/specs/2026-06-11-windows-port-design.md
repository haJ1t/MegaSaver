---
title: Windows port remainder (store-path + CRLF + id-case + Windows CI)
risk: HIGH
status: design
created: 2026-06-11
updated: 2026-06-11
related:
  - docs/superpowers/specs/2026-05-10-windows-port-deferral.md
  - docs/superpowers/specs/2026-05-10-gg-windows-port-design.md
process:
  - architect design pass: required pre-plan (HIGH per CLAUDE.md §12)
  - critic review: required pre-merge
supersedes_claims_in:
  - docs/superpowers/specs/2026-05-10-windows-port-deferral.md §2 (audit 2026-06-11 corrected the stale claims)
---

# Windows port remainder

## §0 TL;DR

Close the four remaining Windows-portability items the FF deferral spec
named, **scoped to what a 2026-06-11 code audit found actually broken**
(the deferral spec's claims were largely stale). The fsync layer was
already closed by GG (PR #51). This spec covers:

- **A. Store-path Windows branch** — `resolveStorePath` /
  `resolveBridgeStorePath` use the wrong base dir on Windows.
- **B. CRLF mixed-EOL drift fix** — a real cross-platform correctness
  bug: mixed line endings falsely report connector `drift`.
- **C. ID lowercase hardening** — make the (currently emergent)
  case-collision safety explicit at the schema boundary.
- **D. Windows CI matrix leg** — add `windows-latest`; the capstone
  that *proves* the port. Requires test fixes (A1 reveals them).

## §1 Audit corrections (what's stale in the FF deferral spec)

`2026-05-10-windows-port-deferral.md` §2 overstated the gaps. Verified
2026-06-11:

- **Case-insensitive "data loss"** → THEORETICAL. Every id is minted by
  `crypto.randomUUID()` (always lowercase); every registry lookup uses
  exact case-sensitive `id === id` (`json-directory-registry.ts:106`)
  so a caller-supplied uppercase variant 404s **before** any path is
  built. Real work = cheap schema hardening (C), not a resolution
  rewrite.
- **CRLF "not normalized"** → pure-CRLF is ALREADY handled: `upsertBlock`
  (`packages/connectors/shared/src/upsert.ts:18-30`) is EOL-aware
  (detect dominant → normalize to LF → restore on output) and a
  pure-CRLF in-sync file round-trips byte-for-byte. The real bug is
  **mixed** EOLs (B).
- **Lock semantics** → `openSync(path, "wx")` is portable (O_EXCL ↔
  CREATE_NEW). The gaps are untested edge cases, addressed by running
  the suite on Windows CI (D), not a lock rewrite.

## §2 Scope & sequencing

**In:** A (incl. the §A.1 home fix + §A.3 skill-packs resolver), B, C,
D. **Out (documented):** a true 2-OS-process Windows lock-contention
test (D covers running the existing suite green; a new multi-process
race harness is a separate item); `mega doctor` Windows gating; `pnpm
clean` `rm -rf` → cross-platform (not in the `verify` path, doesn't
block CI).

**Sub-PR split (architect finding — 4 PRs, NOT one change):**

- **PR1 = A** — store-path win32 branch + §A.1 home/USERPROFILE fix +
  ~18 call sites + §A.3 skill-packs `globalPacksRoot`. Biggest blast
  radius; the actual product correctness.
- **PR2 = B** — CRLF mixed-EOL drift fix (connectors-shared + 2 CLI
  commands). Independent; verifiable without Windows.
- **PR3 = C** — id lowercase refine + changeset error-surface note.
  Wide *validation* radius; its own review.
- **PR4 = D (LAST, hard dependency on PR1+PR3)** — windows-latest matrix
  + test guards. D fixes the tests PR1/PR3 break, so it CANNOT land
  before them. This is the capstone that proves the port.

A, B, C are mutually independent and may land in any order; D is
strictly last.

## §A Store-path Windows branch

`apps/cli/src/store.ts:24` and `apps/gui/bridge/store-path.ts:22` fall
back to `resolve(home, ".local", "share", "megasaver")` on every
platform. On Windows the correct base is `%LOCALAPPDATA%`
(`C:\Users\<u>\AppData\Local`), falling back to
`%USERPROFILE%\AppData\Local`.

**New input field** on both resolver inputs: `platform: NodeJS.Platform`
and `localAppData: string | undefined` (the `%LOCALAPPDATA%` env value;
injected, never read from `process.env` inside the pure function —
mirrors the existing `home`/`xdgDataHome` injection style). Resolution
order becomes:

1. explicit override (`--store` / `MEGASAVER_GUI_STORE`) — unchanged.
2. `XDG_DATA_HOME/megasaver` if set — unchanged (honored on all
   platforms; a Windows user who sets XDG opts in — **documented
   surprise**: a Windows dev with `XDG_DATA_HOME` inherited from a
   Git-Bash/WSL-adjacent shell gets the POSIX-style XDG path, not
   `%LOCALAPPDATA%`. Accepted: XDG is an explicit opt-in).
3. **win32**: `localAppData ?? join(home, "AppData", "Local")` then
   `/megasaver`.
4. **posix**: `join(home, ".local", "share", "megasaver")` — unchanged.

### §A.1 The `home` source — 5th breakage (architect finding)

All 18 CLI call sites and the GUI bridge read `process.env["HOME"]`
ONLY (e.g. `apps/cli/src/commands/connector/sync.ts:158`,
`apps/cli/src/commands/mcp/serve.ts:80`, `apps/gui/bridge/server.ts:16`).
Windows has no `HOME` → injected `home` becomes `""` → the win32 branch
(step 3) joins onto an empty string and resolves to garbage / a
relative path. **Even with the win32 branch, the default store path is
wrong on Windows without this fix.** The boundary (every call site +
the bridge) must read `process.env["USERPROFILE"]` as the Windows
fallback for `home`: `process.env["HOME"] ?? process.env["USERPROFILE"]
?? ""`. The pure resolver is unchanged by this — it still receives a
single `home` string; only the boundary that fills it changes.

### §A.2 Call-site scope (architect finding)

~18 CLI sites across 9 command dirs build the resolver input inline
(`grep resolveStorePath`: project.ts, memory/*, output/*, session/*,
session/saver/*, mcp/*, connector/shared.ts) plus `apps/gui/bridge`.
Each adds `platform` + `localAppData` + the `USERPROFILE` home
fallback. POSIX byte-identical once existing tests also pass
`platform: "linux"`.

### §A.3 Third resolver — skill-packs discover (architect finding)

`packages/skill-packs/src/discover.ts:30` (`globalPacksRoot`) hardcodes
`resolve(home, ".local", "share")` — the same POSIX-only bug, for the
global packs root. **In scope:** fold the same win32/`localAppData`
branch into `globalPacksRoot` so packs discovery is consistent with the
store path. Its callers (`apps/cli/src/commands/pack/*`) already inject
`home`/`xdgDataHome`; they add `platform`/`localAppData` + the
`USERPROFILE` fallback too.

## §B CRLF mixed-EOL drift fix

`status.ts:92-93` and `sync.ts:107-108` classify in-sync/noop by raw
byte equality `upsertBlock(existing) === existing`. With mixed EOLs
(prose CRLF + managed block LF, or vice versa) `detectDominantEol`
collapses the whole file to one EOL, so the comparison is unequal and
status falsely reports `drift` / sync needlessly rewrites.

**Fix (in the comparison only, not the writer):** classify by
EOL-normalized equality. Add a tiny shared helper
`packages/connectors/shared/src/eol.ts`:

```ts
export function normalizeEol(s: string): string {
  return s.replace(/\r\n/g, "\n");
}
```

In status and sync: `normalizeEol(upserted) === normalizeEol(existing)`
decides in-sync/noop. When a REAL content change exists, still write the
EOL-preserving `upsertBlock` output verbatim — **the managed-block
bytes are unchanged**; a real-change write still flattens prose EOL to
the dominant style (pre-existing `upsertBlock` behavior, NOT introduced
here). Net: an unedited file whose halves merely disagree on EOL reports
`in-sync`/`noop` instead of churning. A genuine content change (which
survives `normalizeEol` — only `\r\n`↔`\n` collapses, value diffs
remain) still reports `drift`/`wrote` — no needed sync is hidden.

Export `normalizeEol` from `@megasaver/connectors-shared` index (it is
public-surface-worthy and the two CLI commands both consume it).

## §C ID lowercase hardening

`packages/shared/src/ids.ts` schemas are `z.string().uuid()` —
case-permissive (empirically accepts UPPERCASE in the installed zod).
Add a lowercase **refine** (reject, do not silently transform — a
transform would mask a caller passing a non-canonical id; reject makes
the contract loud):

```ts
const lowercaseUuid = z
  .string()
  .uuid()
  .refine((s) => s === s.toLowerCase(), { message: "id must be lowercase" });
export const projectIdSchema = lowercaseUuid.brand<"ProjectId">();
// sessionIdSchema, memoryEntryIdSchema likewise
```

This makes the case-collision guarantee explicit at the boundary
instead of emergent. `randomUUID()` already emits lowercase so no
production path regresses. Add tests: lowercase accepted, UPPERCASE and
MixedCase rejected, for all three schemas.

**This is a READ-PATH validation gate (architect finding).** The
branded id schemas are embedded in `projectSchema`/`sessionSchema`,
which `json-directory-registry.ts` / `json-directory-store.ts` re-parse
on **every record read**. The refine therefore validates all stored
data on load, not just newly minted ids. Safe *because* every stored id
is lowercase (minted by `randomUUID`); but a single legacy uppercase id
on disk would now throw on every load — acceptable since none can exist
in current data.

**Changed error surface (architect finding — changeset note):** today
`mega session show <UPPERCASE-UUID>` (and the GUI bridge HTTP path-param
`safeParse`) accept the uppercase id at validation, then 404 on the
case-sensitive registry lookup. After C they reject at **validation**
with "id must be lowercase" instead. Reject (not transform) is correct —
transform would let a non-canonical id succeed and mask the contract —
but the changeset must name this validation-vs-not-found surface change
across CLI (`session/show.ts:34`, `end.ts:42`, `output/*`,
`saver/*`) and bridge (`routes/{sessions,retention,token-saver}.ts`).

**Blast-radius check (plan VERIFIES only):** grep confirms **zero**
uppercase UUID literals exist in `apps` + `packages` today (architect
re-ran the case-sensitive grep). The plan runs the grep as a
verification step; there are no fixtures to fix.

## §D Windows CI matrix leg

Convert `ci.yml`'s single `verify` job to a matrix:
`runs-on: ${{ matrix.os }}` over `[ubuntu-latest, windows-latest]`.
Keep `fail-fast: false` so a Windows-only failure still lets Linux
report.

For the leg to pass, these audited test breakages are fixed:

1. **`apps/cli/test/store.test.ts`** — 7 assertions compare against
   literal POSIX strings (`.toBe("/home/user/.local/share/megasaver")`).
   Rewrite to build the expected value with `path.join`/`resolve` (or
   pass `platform` explicitly and assert per-platform), so the same
   test is correct on both OSes. The new A behavior gets its own
   Windows-path assertions (injected `platform: "win32"`,
   `localAppData: "C:\\Users\\u\\AppData\\Local"`).
2. **Symlink tests (~8 files)** — `fs.symlink` throws `EPERM` on
   Windows without Developer Mode/admin. Guard each symlink test body
   with a `describeOrSkipOnWindows` helper (skip on `process.platform
   === "win32"`) — the symlink-rejection guards they cover are
   POSIX-relevant; skipping on Windows does not reduce Windows safety
   (Windows has no symlink-escape via these paths without elevation).
   List (from audit): `connectors/shared/test/filesystem.test.ts`,
   `output-filter/test/resolve-safe-read-path.test.ts`,
   `content-store/test/atomic-write-behavior.test.ts`,
   `core/test/json-directory-registry-paths.test.ts`,
   `skill-packs/test/{load-pack,install}.test.ts`,
   `stats/test/atomic-write.test.ts`, `apps/cli/test/connector.test.ts`.
3. **chmod(0o…) negative tests (5 files — architect added the 5th)** —
   NTFS ignores POSIX mode bits, so `chmod 0o500`-to-force-EPERM setups
   don't deny owner writes on Windows; their assertions never trigger.
   Guard with the same skip-on-Windows helper:
   `core/test/json-directory-registry-lock.test.ts`,
   `core/test/json-directory-registry-failure-modes.test.ts` (lines
   72/89 — the 5th file the first audit missed),
   `connectors/shared/test/filesystem.test.ts`,
   `apps/cli/test/{connector,connector-status}.test.ts`.

4. **Do NOT skip `core/test/json-directory-store.test.ts:199-220`** — it
   mutates `process.platform = "win32"` to exercise the fsync-skip
   branch and restores in teardown. It already tests the win32 path and
   MUST keep passing on a real Windows runner.

The skip helper lives in one place per package that needs it (no
shared test-util package for ~2-line helpers; duplication < premature
abstraction, §8). Each skip is annotated with a WHY comment naming the
platform limitation, so a skipped Windows test is never mistaken for
coverage.

The `home: "/tmp"` literals in connector-status / session-saver /
byte-equality tests are benign — all pass an absolute `storeFlag`, so
the override branch short-circuits before `home` is consumed (architect
confirmed). No fix needed there.

**Acceptance:** the `windows-latest` leg goes green; the count of
skipped tests on Windows is logged in the PR body (no silent
truncation of coverage).

## §3 Files (by item)

- **A:** `apps/cli/src/store.ts`, `apps/gui/bridge/store-path.ts`, their
  callers (`apps/cli/src/commands/**` store-resolution sites,
  `apps/gui/bridge/handler.ts`), tests.
- **B:** new `packages/connectors/shared/src/eol.ts`, its `index.ts`
  export, `apps/cli/src/commands/connector/{status,sync}.ts`, new
  mixed-EOL tests.
- **C:** `packages/shared/src/ids.ts`, `packages/shared/test/ids.test.ts`,
  any uppercase-UUID fixtures the grep finds.
- **D:** `.github/workflows/ci.yml`, `apps/cli/test/store.test.ts`,
  the symlink/chmod test files (skip guards).

## §4 Testing

Per item above, plus the umbrella: `pnpm verify` green on Linux
(local), and the `windows-latest` CI leg green. Local smoke for A:
unit-assert `resolveStorePath({ platform: "win32", localAppData:
"C:\\X\\AppData\\Local", ... })` returns `C:\X\AppData\Local\megasaver`.

## §5 Definition of Done (HIGH)

CLAUDE.md §9 + §12 HIGH: spec (this) + architect design pass + plan +
TDD + `pnpm verify` green + **windows-latest CI green** (the smoke
evidence for a port is the CI leg itself) + critic review (author ≠
reviewer) + changeset (`@megasaver/cli`, `@megasaver/gui`,
`@megasaver/shared`, `@megasaver/connectors-shared` — public/behavior
changes) + wiki (`entities/cli.md`, a new `concepts/windows-support.md`
or update, `syntheses/post-v1.1-roadmap.md` item 4 resolved,
`index.md`, `log.md`; mark the FF deferral spec `superseded`).
