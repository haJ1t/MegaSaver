---
"@megasaver/agent-office": minor
"@megasaver/cli": minor
"@megasaver/gui": patch
---

Seed the office with a 24-role catalog modeled on addyosmani/agent-skills
(one role per skill, grouped by lifecycle phase), replacing the 13 generic
roles. Add `ensurePredefinedRoles` (idempotent) and wire it into the bridge
startup + a `mega office role seed` command, so the roster actually appears in
the GUI and CLI on first run. All seeded roles are `permissionMode: "plan"`
(safe-by-default) and carry their skill slug in `skillPacks`.
