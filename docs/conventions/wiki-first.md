# Wiki-First Memory

The wiki (`wiki/`) is the persistent, shared memory for this project.
Before any other work, read `wiki/index.md` to learn what exists. All
agents share this wiki — what one agent writes, another inherits.

## Startup routine (MANDATORY)

1. Read `wiki/index.md` — catalog of all wiki pages.
2. Read 1–3 targeted pages relevant to the current task.
3. Do NOT read the raw 1421-line `fikri.txt` — use
   `wiki/sources/fikri-original.md`.
4. Do NOT skip the wiki and dive into raw spec/plan files for
   orientation.

## Wiki governance

- The wiki schema lives at `wiki/CLAUDE.md` — it defines folder
  structure, page format, ingestion rules, and hard rules.
- `wiki/raw/` is immutable. Never write there.
- Every non-trivial claim cites a source.
- Pages are not deleted — moved to `wiki/archive/`.
- After completing work, update relevant wiki pages and append a
  timestamped entry to `wiki/log.md`.

## Cross-agent communication

Multiple agents (e.g. Claude Code and Codex) may run side-by-side.
They share two channels:

1. **Wiki** (`wiki/`) — shared persistent memory. Write findings to
   wiki pages so the other agent picks them up.
2. **Shared channel** — `wiki/agent-channel.md` is a scratchpad for
   inter-agent messages. Read it on session start; write status
   updates, handoff notes, or requests there.

Agents may also delegate to one another through configured MCP
bridges where available.

## Wiki-first hard rule

The wiki is the ONLY memory channel for project knowledge across
sessions and across agents. If the wiki lacks a needed page, write it
during the work; do not bypass the wiki.
