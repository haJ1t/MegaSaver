---
"@megasaver/skill-packs": minor
"@megasaver/cli": minor
---

Real skill-packs subsystem: loadPack (manifest validation, path-escape
and symlink guards), filesystem discovery (workspace beats global),
atomic workspace installer with skill-id conflict detection, and the
`mega pack {install,list,remove,info}` CLI. Retires the
not_implemented placeholder error code.
