---
"@megasaver/cli": minor
"@megasaver/connector-claude-code": minor
---

Extend the Claude Code PreToolUse cache adviser to a narrow class of
read-only Bash commands. Only two content-free grammars qualify — recursive
grep with an explicit `-e` pattern over relative paths, and a directory find
with optional `-type` / `-print` — under a 4,096-byte / 64-token budget with
ASCII-space tokens. Shell syntax, path escapes, option clusters, absolute
executables, rg, git, and mutating forms never match.

Before any advice, all five gates must pass: POSIX with the default store, a
uniquely resolved project whose canonical root equals the hook cwd, exactly
one open claude-code registry session, storeRawOutput enabled, and the exact
reconstructed argv accepted by the existing policy and permissions preflight.
The advice names only the registry session UUID and tells the agent to rerun
the same approved command through `mega output exec`; it never restates the
command, argv, pattern, paths, or permission details, and adds no
permissionDecision or input rewrite. A family is offered once per session.

This phase does not run, rewrite, deny, or grant any Bash command. An advice
event records only that guidance was offered — it is not evidence that the
agent adopted the route, and it makes no token or cost-savings claim. Advice
state evolves to version 3 (offeredOutputRouteFamilies) inside the existing
secure capsule transaction; malformed, v1, and unknown-future state stays
untouched. Windows continues to create no hook state at all.
