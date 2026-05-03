---
type: schema
purpose: wiki anayasası
updated: 2026-05-03
---

# Wiki Schema — Mega Saver

This vault is the **persistent memory** for the Mega Saver project. It compounds across sessions so future Claude instances do not re-discover decisions, re-read the original `fikri.txt`, or re-explain the architecture.

> **Read order at session start:** `wiki/index.md` first (catalog) → targeted page reads on demand. Do NOT read all pages.
>
> **Wiki-first hard rule (user directive 2026-05-03):** the wiki is the ONLY memory channel for project knowledge. Do NOT skip the wiki and dive into raw fikri / spec / plan files for orientation. Wiki pages are the index and the synthesis; raw files are accessed only after the wiki points at them with a specific reason (a quote needed, a detail not yet captured). If the wiki lacks a needed page, the right move is to write it during the work, not to bypass the wiki.

## Purpose

Mega Saver is a ContextOps platform for frontier coding agents. This wiki tracks the *why*, *what was decided*, *what's next* — the things not derivable from the code or git log.

## Folder structure

| Folder        | Contents                                              | Who writes |
|---------------|-------------------------------------------------------|-----------|
| `raw/`        | Original sources. **Immutable.** Read-only. Some files in here are gitignored (private pre-publication notes); the agent works from `sources/` indexes instead. | User only |
| `sources/`    | One summary page per item in `raw/` + spec/plan refs  | Agent     |
| `decisions/`  | Locked-in choices with rationale                      | Agent     |
| `concepts/`   | Cross-cutting ideas (e.g. evidence-preserving)        | Agent     |
| `entities/`   | Subsystems, packages, connectors                      | Agent     |
| `workflows/`  | Process guides (skills, routing, dogfood)             | Agent     |
| `syntheses/`  | Cross-page summaries answering big questions          | Agent     |
| `archive/`    | Stale/wrong pages moved here (never deleted)          | Agent     |

## Page format

Every page starts with frontmatter:

```yaml
---
title: <page title>
tags: [tag1, tag2]
sources: [raw/x.txt, sources/y.md]
status: active | stale | superseded
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

Body rules:
- Markdown headings start at `##` (title goes in frontmatter or H1).
- `[[wiki-link]]` for internal references (Obsidian-style).
- Every non-trivial claim cites a source: `(source: raw/fikri.txt:123)`.
- Pages are short (≤50 lines preferred). Split when longer.

## Naming

- Files: `kebab-case.md`.
- Entities canonicalized lowercase (`core-engine.md`, not `Core Engine.md`).
- One concept per page.

## Operations

### INGEST (new source in `raw/`)

1. Read source.
2. Write `sources/<slug>.md` with: 5-line summary, key claims, links to related entities/concepts.
3. Update relevant `entities/`, `concepts/`, `decisions/` pages.
4. Update `index.md`.
5. Append timestamped entry to `log.md`: `## [YYYY-MM-DD] ingest | <slug>`.
6. Flag any contradictions with existing pages.

### QUERY (user asks something)

1. Read `index.md`.
2. Open the 1–3 most relevant pages.
3. Answer with citations (`source: <file>:<line>`).
4. If the answer is non-trivial, **file it back** as a new page in `syntheses/` or update an existing page. Append to `log.md`.

### LINT (periodic health check)

1. List orphan pages (no inbound links from `index.md` or other pages).
2. List `status: stale` pages and decide: update or archive.
3. List concepts mentioned ≥3 times across pages but lacking own page → create.
4. Report contradictions across pages.
5. Append summary to `log.md`: `## [YYYY-MM-DD] lint | N orphans, M stale, K new pages`.

## Hard rules

1. `raw/` is **immutable**. Never write or modify files there.
2. Every important claim has a source citation.
3. Contradictions are flagged, not deleted.
4. When updating page X, check pages that link to X.
5. Every operation logs to `log.md`.
6. Pages are not deleted — moved to `archive/` with reason in frontmatter.
7. Schema co-evolves: if a rule does not fit, update this file.
8. Keep pages short. Split when > 50 lines preferred, > 100 lines required.

## Domain-specific notes

- The project's main `CLAUDE.md` (at `MegaSaver/CLAUDE.md`) is the **product/code governance**. THIS wiki schema (`wiki/CLAUDE.md`) is the **knowledge-base governance**. Do not confuse them.
- Spec files (`docs/superpowers/specs/`) and plan files (`docs/superpowers/plans/`) are NOT duplicated into the wiki. Wiki pages in `sources/` reference them with one-line summaries.
- The original 1421-line `fikri.txt` lives at `raw/mega-saver-platform-fikri.txt`. Section index in `sources/fikri-original.md`.

## Token efficiency

This wiki exists to **save tokens**. To honor that:
- Future sessions read `index.md` (≤30 lines) first.
- Targeted page reads, not bulk dumps.
- The `fikri.txt` (1421 lines) should NEVER be read whole again unless ingesting a delta. The summary + section index in `sources/fikri-original.md` covers 95% of needs.
