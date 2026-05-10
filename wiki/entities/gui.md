---
title: '@megasaver/gui'
tags: [entity, app, gui, v0.4]
sources:
  - docs/superpowers/specs/2026-05-10-ii-gui-app-design.md
  - docs/superpowers/specs/2026-05-10-ll-gui-v1-design.md
status: published
created: 2026-05-10
updated: 2026-05-10
---

# `@megasaver/gui`

Localhost web shell over the core registry. App at `apps/gui/`,
`private: true`. v1 turns the v0.3 read-only bootstrap into a
single-developer console.

## Stack

Vite + React 18 + Tailwind v3.4 (JIT) + a tiny `node:http` bridge
that imports `@megasaver/core` directly. No router. No state lib —
React `useState`/`useEffect` hooks. Token system via CSS variables
in `apps/gui/src/styles/tokens.css`; design language documented in
`apps/gui/DESIGN.md` ("Editorial Terminal" — DM Mono + zinc + amber
accent, light/dark via `prefers-color-scheme`).

## Ports

- Vite dev server: `5173` (fixed; proxies `/api → 5174`).
- Bridge: `5174` (env override `MEGASAVER_GUI_BRIDGE_PORT`).

`pnpm --filter @megasaver/gui dev` boots both via `concurrently`
with `--kill-others-on-fail`. Escape hatches: `dev:vite`,
`dev:bridge` (preserved for isolated debugging).

## Bridge endpoints (`apps/gui/bridge/handler.ts`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | `{ ok: true, store }` |
| GET | `/api/projects` | sorted createdAt asc |
| GET | `/api/sessions[?projectId]` | sorted startedAt desc |
| GET | `/api/memory[?projectId]` | sorted createdAt desc |
| POST | `/api/sessions` | 201 with created Session |
| POST | `/api/sessions/:id/end` | 200; 409 if already ended |
| PATCH | `/api/sessions/:id` | 200; 409 if ended; 400 empty patch |
| POST | `/api/memory` | 201; cross-field guard on scope/sessionId |

Errors carry the closed envelope `{ error, code, details? }` per
spec §4b. CORS posture: loopback only — Origin must be missing or
match `localhost|127.0.0.1:5173` (spec §4c).

## Closed-enum surfaces

- `ViewId = ["memory", "sessions"]` (preserved from v0.3).
- `WriteAction = ["create-memory", "create-session", "end-session", "update-session"]`.
- `BridgeErrorCode = [...]` (10 codes, alphabetic; mirrored bridge
  ↔ frontend, see `apps/gui/src/bridge-error-code.ts`).

Each pinned with a `.test-d.ts` AA3-canonical assertion.

## Accessibility commitments (spec §9)

Keyboard-reachable, focus-visible everywhere, `role="alert"` on
bridge errors, `aria-current="page"` on the active view, full
labels on icon-only controls, `prefers-reduced-motion` honoured.

## Boundary rules

- The bridge is a system boundary: every request body parsed at
  the boundary with Zod, no internal trust of unparsed input.
- The frontend never imports `node:*` — bridge is server-only.
- No agent-specific logic. Project / session / memory shapes are
  Core's, surfaced verbatim.
- Project lifecycle (create / update / delete) remains CLI-only in
  v1; GUI is read-only for projects.

## Risk

Risk MEDIUM. Full superpowers chain shipped: architect spec →
designer skill chain → test-engineer (152 tests) → executor
(handler + integration + concurrently) → code-reviewer + verifier
in fresh contexts.

## Related

- [[entities/core]]
- [[entities/cli]]
- [[concepts/agent-agnostic-core]]
