---
"@megasaver/cli": minor
"@megasaver/gui": patch
---

Office agent `workdir` is now derived from the project directory instead of being
chosen manually. The CLI `office agent create` command drops its `--workdir` flag
and uses the invocation cwd; the GUI add-agent form no longer has a workdir field
and uses the selected workspace's directory. The bridge now rejects an agent
`workdir` that does not match its workspace (`encodeWorkspaceKey(workdir) === wk`).
