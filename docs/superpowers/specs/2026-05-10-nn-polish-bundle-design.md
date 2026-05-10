---
title: GUI v1.1 polish bundle (NN)
slug: 2026-05-10-nn-polish-bundle
status: approved
risk: LOW
author: executor
date: 2026-05-10
issue: 61
predecessor: 2026-05-10-ll-gui-v1-design
---

# GUI v1.1 polish bundle (NN)

## §1 Source

PR #57 (`LL — GUI v1`) shipped on 2026-05-10. The pre-merge `code-reviewer`
pass surfaced six stylistic / a11y polish items that did not block merge but
were deferred to follow-up issues. Issue #61 bundles five of them — all
small, all independent — into a single ship to amortise the spec /
plan / verify overhead.

Items are taken verbatim from the PR #57 review:

- MIN1: section-label `<p>` styled as heading but not announced as one
- MIN2: `prefer-workspace-packages` npm warning at GUI dev boot (×6)
- MIN3: `shortId` helper duplicated across consumers
- NIT1: forced-shutdown branch in `bridge/server.ts` is silent
- NIT2: bridge responses lack a `Content-Security-Policy` header

Issue #61 explicitly defers a sixth item (off-by-one comment) — out of
scope for this spec.

## §2 Items

### §2.1 MIN — section-label semantic heading

**File(s):** `apps/gui/src/components/session-forms.tsx`,
`apps/gui/src/components/memory-forms.tsx`

**Before:**

```tsx
<p className="text-xs text-text-muted uppercase tracking-widest">New session</p>
```

Three call sites: `New session` (session-forms:132), `Edit session`
(session-forms:232), `New memory entry` (memory-forms:95). All three are
visually formatted as a section heading (uppercase tracking-widest) but
emitted as `<p>` — screen readers do not announce them as a section start.

**After:**

```tsx
<h3 className="text-xs text-text-muted uppercase tracking-widest font-normal">
  New session
</h3>
```

`<h3>` is the correct semantic level: the form lives inside the screen's
`<h2>` "Sessions" / "Memory" header. `font-normal` is added to override
the user-agent default `bold` for `<h3>` so the visual treatment stays
identical to the previous `<p>`.

**Why:** WCAG 2.1 `1.3.1 Info and Relationships` + ARIA practices —
visually-styled headings must use heading elements (or `role="heading"`)
so AT users can jump between sections.

### §2.2 MIN — `prefer-workspace-packages` npm warning

**File(s):** `apps/gui/package.json` (`dev` script)

**Before:** `pnpm --filter @megasaver/gui dev` produces six identical
`npm warn Unknown env config "..."` lines on boot (three each for the
`prefer-workspace-packages`, `recursive`, and `auto-install-peers`
keys, doubled across the vite and bridge concurrent processes). Root
cause: `concurrently` used the `npm:<script>` invoker syntax, which
runs `npm run <script>` — and npm's config validator warns when it
sees the pnpm-set env vars (`npm_config_prefer_workspace_packages` &c)
before any logging filter applies.

**After:** Swap `concurrently` invocations from `npm:dev:vite` /
`npm:dev:bridge` to `pnpm dev:vite` / `pnpm dev:bridge`. The bridge
and vite are launched by the same package manager that the workspace
runs on, so the unknown-key complaint never surfaces.

```json
"dev": "concurrently --kill-others-on-fail --names vite,bridge -c blue,magenta \"pnpm dev:vite\" \"pnpm dev:bridge\""
```

**Why:** dev-boot noise erodes trust in the log stream. Routing the
concurrent processes through the workspace's actual package manager
removes the npm/pnpm impedance mismatch entirely — no warning, no
suppression, no environment hack.

**Rejected alternative:** `NPM_CONFIG_LOGLEVEL=error` prefix on
`dev:bridge` — verified empirically not to suppress the warning,
because npm's config validator runs before the loglevel filter
applies. Also asymmetric (would not fix the vite side).

**Rejected alternative:** `.npmrc` `prefer-workspace-packages=false` —
would change pnpm's actual workspace resolution behaviour, which we
want to keep on. Setting it at the npm side is the wrong fix.

### §2.3 MIN — `shortId` helper consolidation

**Files:**

- New: `apps/gui/src/lib/short-id.ts` — exports `function shortId(id: string): string`
- Edit: `apps/gui/src/views/sessions-view.tsx` — drop local helper, import from lib
- Edit: `apps/gui/src/views/memory-view.tsx` — drop local helper, import from lib
- Edit: `apps/gui/src/components/memory-forms.tsx` — replace `s.id.slice(0, 8)` with `shortId(s.id)`

**Before:** Two identical `function shortId(id: string): string { return id.slice(0, 8); }`
copies in `sessions-view.tsx:22` and `memory-view.tsx:21`, plus one
inline `s.id.slice(0, 8)` in `memory-forms.tsx:144`.

**After:** One canonical helper in `apps/gui/src/lib/short-id.ts`; all
three consumers import it.

**Why:** Per CLAUDE.md §8 ("3 similar lines > premature abstraction") —
we now have 3 identical sites, so consolidation pays for itself. Also
reduces drift risk if the slice length ever changes.

### §2.4 NIT — forced shutdown logging

**File:** `apps/gui/bridge/server.ts:39`

**Before:**

```ts
setTimeout(() => process.exit(0), 1000).unref();
```

**After:**

```ts
setTimeout(() => {
  process.stderr.write("[bridge] forced shutdown after 1s grace period\n");
  process.exit(0);
}, 1000).unref();
```

**Why:** the 1 s fallback only fires when `server.close()` did not
complete — typically a hung socket. Silent exit makes that case
indistinguishable from a clean shutdown. The warn line is diagnostic
only; no behaviour change.

### §2.5 NIT — CSP header on bridge responses

**File:** `apps/gui/bridge/handler.ts` — `sendJson` helper

**Before:** responses carry `content-type`, `cache-control: no-store`,
`vary: origin`, and (optionally) the CORS allow-origin header. No CSP.

**After:** add `content-security-policy: default-src 'self'` to the
header set in `sendJson`. The handler is loopback-only, so this is
defence-in-depth — narrows what a future template / HTML response
could render.

```ts
const headers: { [key: string]: string; vary: string } = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy": "default-src 'self'",
  vary: "origin",
};
```

**Why:** the bridge returns JSON today, but `Content-Security-Policy`
is essentially free on JSON and locks down the surface against any
future HTML response path. `default-src 'self'` is the strictest
useful policy — bridge never serves cross-origin resources by design.

**Rejected alternative:** `default-src 'self' fonts.googleapis.com` —
GUI v1 fix-up (PR #57, H1) dropped the Google Fonts CDN in favour of
`@fontsource/dm-mono`. The CDN is no longer a dependency.

**Coordination with #58:** Issue #58 is splitting `handler.ts` (607
LOC, over the 300-LOC cap from CLAUDE.md §8). If #58 merges first, the
CSP header lands in whichever helper file inherits `sendJson`
(probably `error-mapping.ts` or a `response.ts` helper). If this PR
merges first, #58 picks up the CSP change with its refactor. Either
way, the change is mechanical.

## §3 Test impact

- 854 existing tests must stay green.
- No test asserts on the section-label text via `getByText("New session")`
  or similar; tests use form `aria-label` (`"Create session"`,
  `"Update session"`, `"Create memory entry"`) for queries.
- The CSP-header change may want a new bridge test asserting the
  header is present on a known endpoint. Add one assertion in
  `apps/gui/test/bridge/handler.test.ts` against `GET /api/health`.
- No new test for shutdown warn — exercising the 1 s race in test is
  flaky and the change is observably safe.
- No new test for npm-warn suppression — verified by foreground smoke.

## §4 Alternatives considered

1. **`role="heading" aria-level={3}` on the `<p>`** — works, but
   `<h3>` is the idiomatic answer. Use the language the platform
   already provides.
2. **CSP with `fonts.googleapis.com`** — rejected; CDN already
   removed in PR #57 fix-up. `'self'` is the right baseline.
3. **`.npmrc` `prefer-workspace-packages=false`** — rejected;
   that flag is for pnpm, and disabling it would change resolution
   semantics. The fix is on the npm side.
4. **Keep `shortId` inlined in three places** — rejected; CLAUDE.md
   §8 explicitly calls out 3-site duplication as the threshold.
5. **Wait for #58 to merge before adding CSP** — rejected; the change
   is one line and additive. Rebase cost is trivial.

## §5 Risk classification

**LOW.** Five small, independent changes. Each is reversible in one
commit. No public API change. No data path touched. Test surface
narrowly grows by one bridge-header assertion. Verifier evidence:
`pnpm verify` exit 0 + foreground dev-boot smoke with CSP curl.
