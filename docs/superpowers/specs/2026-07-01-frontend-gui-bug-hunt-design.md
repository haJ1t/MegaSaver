---
title: Frontend GUI Bug Hunt
risk: medium
status: draft
---

# Frontend GUI Bug Hunt

## Goal

Find and fix real bugs in the Mega Saver GUI (`apps/gui`) before they reach users. The GUI currently passes all automated checks (407 tests, typecheck clean, Biome clean), so the hunt targets bugs that existing tests do not catch: UI state, accessibility, event handling, and runtime behavior.

## Scope

- `apps/gui/src` — React components, views, cockpit panels, hooks, and utilities.
- `apps/gui/test` — existing tests to identify coverage gaps, not to rewrite.
- `apps/gui/bridge` — only where bridge behavior surfaces in the GUI (e.g., error rendering, loading states).

## Background

The GUI is a React + Vite + Tailwind app that serves as a local control panel for Mega Saver. It has three top-level views:

- `claude-sessions` — session list and cockpit.
- `agent-office` — agent office board and role manager.
- `agent-setup` — setup doctor.

All automated checks pass, but that only proves the code matches current tests, not that the UI is bug-free.

## Approach

1. **Static UI audit with `impeccable` skill**
   - Audit components for React anti-patterns: missing keys, stale closures, race conditions, unmemoized expensive renders, incorrect effect dependencies.
   - Check accessibility basics: button types, ARIA labels, focus management, color-contrast assumptions.
   - Review error boundaries / error-state rendering. The GUI has a `states.tsx` component; verify every caller handles errors.

2. **Runtime smoke test**
   - Start the GUI dev server (`pnpm dev:vite`) and bridge (`pnpm dev:bridge`).
   - Walk the main user flows: switch views, select a session, open cockpit panels, trigger agent-office actions.
   - Capture any visual glitch, console error, or interaction that does not match intent.

3. **Fix with TDD**
   - For each confirmed bug, write a failing test first.
   - Apply the smallest code change that makes the test pass.
   - Re-run GUI tests, typecheck, and Biome.

4. **Verification**
   - `pnpm --filter @megasaver/gui test`
   - `pnpm --filter @megasaver/gui typecheck`
   - `pnpm exec biome check apps/gui/src apps/gui/test`
   - Runtime evidence for each fixed bug.

## Success Criteria

- `pnpm verify` remains green for the GUI scope.
- Every confirmed bug has a regression test.
- Each fix links to the audit finding in commit messages.
- No unrelated refactoring; only bug fixes and their tests.

## Out of Scope

- New features or visual redesigns.
- Bridge API changes (only GUI-side rendering fixes).
- Performance optimization without a measurable bug.

## Risks

- **Medium**: UI changes can subtly alter behavior not covered by tests. Runtime verification mitigates this.
- **Mitigation**: Keep diffs minimal and add regression tests for every fix.
