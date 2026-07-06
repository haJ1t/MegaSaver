---
"@megasaver/cli": minor
"@megasaver/gui": minor
---

`mega gui`: serve the packaged desktop console from the published CLI.

`npm install -g @megasaver/cli && mega gui` now starts the GUI bridge and opens
the console in your browser — no clone, no `pnpm`, no build. The command binds
loopback-only, mints a per-run bearer token, serves the bundled GUI dist plus
the `/api` bridge same-origin, prints the tokenized URL, and opens the browser
(skip with `--no-open`). It runs in the foreground; Ctrl-C stops it.
`--port <n>` pins the port, `--store <dir>` selects the store.

- **@megasaver/cli**: new `mega gui [--port <n>] [--no-open] [--store <dir>]`
  command. The build now inlines the GUI bridge into the standalone bundle and
  ships the built frontend at `dist-bundle/gui`, resolved relative to the bundle
  at runtime.
- **@megasaver/gui**: the bridge is hardened for distribution — loopback bind, an
  always-on bearer-token wall on every `/api` route (query token accepted for
  SSE), origin-derived CORS, and static serving of the built GUI. A new
  `@megasaver/gui/bridge` entry exposes `startGuiBridge` + `resolveShippedGuiDistDir`
  as the single boot path shared by the dev server and `mega gui`.

Security: there is no code path where `mega gui` starts the packaged GUI without
the token wall — no flag and no env disables `/api` auth.
