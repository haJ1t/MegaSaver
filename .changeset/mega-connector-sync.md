---
"@megasaver/cli": minor
---

feat: add `mega connector sync` CLI command

Wires the existing `@megasaver/connectors-shared` and
`@megasaver/connector-generic-cli` primitives into a single user-facing
verb. `mega connector sync <projectName>` writes a Mega Saver block
into each known agent file (`CLAUDE.md`, `AGENTS.md`) under the
project's `rootPath`. Default behaviour skips files that do not
already exist; `--target <id>` opts a specific target into seeding.
Best-effort partial failure: each target reports its status (`wrote`,
`noop`, `created`, `skipped`, `error`) on stdout; exit 1 if any
target failed.
