# GUI Electron Desktop Window — Plan

Spec: `docs/superpowers/specs/2026-06-21-gui-electron-desktop-design.md`

## Steps

1. Add devDeps `electron`, `wait-on` to `@megasaver/gui`.
   → verify: both appear in `apps/gui/node_modules`, `electron --version` resolves.
2. Add `apps/gui/electron/main.cjs` — BrowserWindow loading
   `MEGASAVER_GUI_URL ?? http://localhost:5173`, standard lifecycle.
   → verify: file present, valid CJS.
3. Add `app` script to `apps/gui/package.json`: concurrently runs
   vite + bridge + (`wait-on tcp:5173 && electron electron/main.cjs`).
   → verify: `pnpm --filter @megasaver/gui app` boots all three.
4. Smoke run: launch, Electron window opens, Mega Saver UI renders,
   workspaces list loads (proxy → bridge → core path works).
   → verify: screenshot of populated window.

## Out of scope

Installer (`.dmg`/`.app`), code signing, static-build serving, cross-platform.
