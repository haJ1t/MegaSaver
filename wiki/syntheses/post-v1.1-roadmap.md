---
title: Post-v1.1 Roadmap — Remaining Work
tags: [roadmap, backlog, mvp]
sources: [index.md, decisions/bootstrap-matrix.md, syntheses/mega-saver-product.md, sources/fikri-original.md, log.md]
status: active
created: 2026-06-10
updated: 2026-06-11
---

# Post-v1.1 Roadmap — Remaining Work

> **Scope note (2026-06-11):** this page tracks the **v1.1 cleanup
> backlog** (npm publish, GUI packaging, i18n, fikri §16 features). The
> **strategic product direction** — the Phase 0–10 DIMMEM/LAMR/FORGE
> arc, reconciled against shipped code — now lives at
> [[syntheses/contextops-roadmap]]. The fikri §16 items below map onto
> that roadmap: Repo Scanner → Phase 2, Memory Vault → Phase 1, Token
> Audit → Phase 8.

State as of 2026-06-11: v1.1.0 shipped (2026-06-04); since then PRs #102–#112
merged (main @ `c2ee52a`), CI green on **both** `ubuntu-latest` and
`windows-latest`. The v0.1 headless MVP and the v1.0 Context Gate epic are
complete; full Windows support is now shipped (source: [[concepts/windows-support]]).
Dogfood drift fully closed: `CLAUDE.md` is now a managed `conventions:sync`
consumer (#112) — all agent files regenerate from `docs/conventions/`.

## Resolved (post-v1.1 arc, 2026-06-10/11)

- ~~**#3 Stats wiring**~~ — PR #102. `runOutputPipeline` records a
  `TokenSaverEvent`; `mega session saver stats` reads the real store (BB6 stub
  retired). See [[entities/stats]].
- ~~**#2 skill-packs real implementation**~~ — PR #103. Real loader, discovery,
  atomic installer, `mega pack` CLI; symlink + path-escape guards (critic found
  + fixed a `removePack` traversal CRITICAL). See [[entities/skill-packs]].
- ~~**#4 Windows port remainder**~~ — PRs #104–#108. win32 store path
  (%LOCALAPPDATA%, HOME→USERPROFILE), CRLF mixed-EOL drift fix, lowercase id
  contract, atomic-write `r+` Windows fsync fix, `.gitattributes` LF, and a
  `windows-latest` CI matrix leg that proves the port. The case-insensitive
  "collision" was found theoretical (lowercase UUIDs). See [[concepts/windows-support]].
- ~~**mcp HOME→USERPROFILE**~~ (follow-up) — PR #109. `resolveHomeDir` helper;
  `mega mcp {status,install,uninstall}` resolve agent-config paths correctly on
  Windows.
- ~~**test-typecheck no-op**~~ (follow-up) — PR #110. `tsconfig.test.json`
  silently excluded `test/` from typecheck; enabling it surfaced + fixed 113
  pre-existing type errors and a cross-package e2e import leak.

## Remaining, by priority

1. ~~**npm publish**~~ — **SHIPPED 2026-06-18. `@megasaver/cli@1.0.2` is live on
   npm** (`registry.npmjs.org/@megasaver/cli/1.0.2`), installable via
   `npm i -g @megasaver/cli` (`mega` bin). The MVP→installable-product gap is
   closed. How it went: maintainer claimed the `@megasaver` org/scope + created
   a write token + set `NPM_TOKEN`; the `v1.0.2` tag triggered `release.yml` but
   the **CI npm-publish job could not satisfy 2FA** — the account/org enforces
   2FA-for-writes and the granular token + account "auth only" change still hit
   `EOTP`, and the maintainer uses a **security key (FIDO/WebAuthn)**, not TOTP,
   so `--otp=<code>` is impossible in CI. Resolution: published the prebuilt
   tarball (`npm pack` of the released `main` code) **locally** via
   `npm publish <tarball> --access public`, completing the security-key 2FA in
   the browser. Follow-up for hands-off CI releases: either disable
   2FA-for-writes at the **org** level (the per-account "auth only" change was
   insufficient — org enforcement overrode it), or provision a token type that
   bypasses 2FA. Until then, releases are a one-command local publish from a
   clean `main` checkout. (Minor: `apps/cli` still lists `typescript` as a
   runtime `dependency`; if it is bundled, drop it to shrink `npm i` footprint.)
   - **Publish-readiness VERIFIED 2026-06-18:** `pnpm --filter @megasaver/cli
     bundle` emits a single self-contained `dist-bundle/mega.mjs` (~11 MB, `0`
     `@megasaver/*` runtime refs); `files:["dist-bundle"]` + `bin.mega` +
     `publishConfig.access:public` + `prepack` (bundle + `strip-publish-manifest`
     drops the `workspace:*` devDeps); `release.yml` has the NPM_TOKEN gate job +
     `npm-publish` job wired to `NODE_AUTH_TOKEN`. Everything is ready — only the
     three maintainer-only steps remain (claim `@megasaver` scope, create the
     automation token, set the `NPM_TOKEN` secret). Nothing left to build.
     (Minor optional follow-up: `apps/cli` lists `typescript` as a runtime
     `dependency`; confirm it's needed at runtime vs already in the bundle — if
     bundled, the dep could be dropped to shrink `npm i` footprint.)
2. ~~**conventions:sync → CLAUDE.md tagged blocks**~~ — **SHIPPED, PR #112**
   (merged `c2ee52a`). `CLAUDE.md` is now a managed
   consumer (§0 wiki-first + §1–§13). Billed "small/cosmetic" but the audit
   found CLAUDE.md had drifted from the sources → real work was a HIGH-risk
   per-section content reconciliation (sources verified ⊇ CLAUDE for 11/13;
   2 enriched; §0 promoted to `wiki-first.md`). `conventions:check` now
   guards CLAUDE.md. See [[entities/conventions-sync]].
3. **GUI native packaging** — Tauri/Electron, deferred to v1.1+. Design phase
   (skill-routing §5b). (source: index.md v0.3 backlog note)
4. **i18n `tr`** — product strings English-only since v0.1; add `tr` via
   `packages/shared/i18n`. (source: decisions/bootstrap-matrix.md #8)
5. **Feature backlog (fikri §16 top-30)** — not yet built: Token Audit, Repo
   Scanner, Ignore Generator, Instruction Optimizer, Context Packer,
   Conversation Compactor, Memory Vault. Already covered by Context Gate: Tool
   Output Compressor (output-filter), Smart Retrieval (retrieval BM25),
   Evidence-Preserving Compression (pipeline). (source: syntheses/mega-saver-product.md)

## Deferred follow-ups (tracked, non-blocking)

- True 2-OS-process Windows lock-contention test (single-process lock suite
  passes on the Windows leg).
- e2e typecheck gap — `test/e2e/v1-closeout-flow.test.ts` is excluded from the
  CLI per-package typecheck (cross-package source import); a multi-package
  `tsconfig` with both apps in `rootDirs` would restore static coverage
  (runtime-covered today).

## Wiki/housekeeping

- ~~Pending entity page: `conventions-sync`~~ — **done 2026-06-11**, page
  written ([[entities/conventions-sync]]).
- ~~syntheses/mega-saver-product.md status line "plan execution pending"~~
  — **done**, bootstrap-status section now reflects v1.1-shipped reality.
- ~~v0.3 backlog item "connector aider sync end-to-end" stale~~ — **done**,
  verified shipped (PR #21 `184b13d` + #29) and struck in index.md.
- **Bonus lint (2026-06-11):** index.md "v0.3 — open backlog" block was
  4/5 stale — also struck mcp-bridge (PR #83), skill-packs (#103), Windows
  port remainder (#104–#108). Only "CLAUDE.md tagged blocks" (#2) remains
  open there.
