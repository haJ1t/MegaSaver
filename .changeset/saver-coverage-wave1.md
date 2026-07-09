---
"@megasaver/cli": minor
"@megasaver/context-gate": patch
"@megasaver/connector-claude-code": patch
---

Saver coverage wave 1: the PostToolUse saver now compresses Task/subagent
reports, BashOutput/Monitor retrievals, WebSearch/ToolSearch results, and
third-party `mcp__*` tool outputs whose response exposes a recognized text
shape (bare string, `{result}`/`{content}`, or a text content-block array) —
16 KiB conservative floor; Mega Saver's own `mcp__megasaver__*` bridge is
excluded. Any unrecognized response shape safely falls through untouched.
Plus Grep files-mode/Glob
filename arrays, Bash stderr (larger-stream slot), and the text blocks of
mixed content arrays. Recovery is now real: `fetchChunk` reads hook-written
overlay chunk sets, so the compression footer's new
`mega output chunk "<set>" "0"` instruction works in every session (and an
expansion is never itself re-compressed). `mega hooks install` repairs a
stale hook matcher in place, and both hook matchers are anchored so they
never over-match unrelated tool names.
