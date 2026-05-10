---
title: GUI v1.1 polish bundle (NN) — plan
slug: 2026-05-10-nn-polish-bundle
spec: 2026-05-10-nn-polish-bundle-design
status: approved
risk: LOW
date: 2026-05-10
issue: 61
---

# Plan — GUI v1.1 polish bundle (NN)

Five small fixes from PR #57 review, bundled. Each step is independent
and can be reverted in isolation.

## Step 1 — Hoist `shortId` helper

- Create `apps/gui/src/lib/short-id.ts`:
  - exported `function shortId(id: string): string { return id.slice(0, 8); }`
- Edit `apps/gui/src/views/sessions-view.tsx`:
  - remove local `function shortId`
  - add `import { shortId } from "../lib/short-id.js";`
- Edit `apps/gui/src/views/memory-view.tsx`:
  - same: drop local, add import
- Edit `apps/gui/src/components/memory-forms.tsx`:
  - add `import { shortId } from "../lib/short-id.js";`
  - replace `s.title ?? s.id.slice(0, 8)` with `s.title ?? shortId(s.id)`

## Step 2 — Section labels → semantic `<h3>`

- `apps/gui/src/components/session-forms.tsx`:
  - line 132: `<p ...>New session</p>` → `<h3 className="text-xs text-text-muted uppercase tracking-widest font-normal">New session</h3>`
  - line 232: same swap for `Edit session`
- `apps/gui/src/components/memory-forms.tsx`:
  - line 95: same swap for `New memory entry`
- `font-normal` added to preserve visual weight (override `<h3>` default bold).

## Step 3 — Forced-shutdown warn

- `apps/gui/bridge/server.ts:39`:
  - replace `setTimeout(() => process.exit(0), 1000).unref();`
    with the multi-statement form that writes
    `"[bridge] forced shutdown after 1s grace period\n"` to stderr before exiting.

## Step 4 — CSP header on bridge responses

- `apps/gui/bridge/handler.ts`, `sendJson` function (around line 115):
  - add `"content-security-policy": "default-src 'self'",` to the `headers`
    object literal.
- `apps/gui/test/bridge/handler.test.ts`:
  - add one assertion in the existing `GET /api/health` describe block
    that `res.headers.get("content-security-policy") === "default-src 'self'"`.

## Step 5 — Silence `prefer-workspace-packages` npm warn

- `apps/gui/package.json`, `scripts.dev`:
  - swap concurrently's `npm:dev:vite` / `npm:dev:bridge` invokers
    for `pnpm dev:vite` / `pnpm dev:bridge`, so the concurrent processes
    use the workspace's package manager and never invoke npm — eliminating
    the npm-config-validator warnings at source.
- `scripts.dev:bridge` and `scripts.dev:vite` themselves are unchanged.
- No `.npmrc` change.

## Step 6 — Verify

```bash
pnpm install
pnpm verify              # MUST exit 0; existing 854 + new CSP assertion green
```

Foreground smoke (separate shells):

```bash
pnpm --filter @megasaver/gui dev   # foreground ~10s
# Shell B:
curl -sI http://localhost:5174/api/health | grep -i content-security
# Expect: content-security-policy: default-src 'self'
# Count `npm warn` lines in dev output → must be 0
# pkill -f concurrently
```

## Step 7 — Wiki + commit + PR

- Append `## [2026-05-10] chore | NN — GUI v1.1 polish bundle (#61)` line
  to `wiki/log.md`.
- One commit (Conventional Commits + caveman-commit subject ≤ 50):
  `chore(apps/gui): v1.1 polish bundle (NN)`
  with body listing all five items + `Closes #61`.
- `git push -u origin chore/nn-polish-bundle`.
- `gh pr create` — link issue #61, paste verify exit 0, note that CSP
  landed in `apps/gui/bridge/handler.ts` and may need rebase if #58
  merges first.

## Rollback

Each step is one or two files; revert by file is trivial. If any of the
five items fails verify, drop it from the commit and ship the
remaining four; the bundle is not atomic.
