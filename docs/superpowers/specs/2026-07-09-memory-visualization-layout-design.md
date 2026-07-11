---
title: Memory visualization layout
status: approved
risk: LOW
approval: User request, 2026-07-09
---

# Memory visualization layout

## Problem

The Memory page renders its note list, graph, and decision trace as one
vertical sequence. The visualization surfaces do not have a layout contract
that reserves the broad content area available beside the note list.

## Decision

On large screens, the active workspace content uses a two-column grid: a
bounded notes column and a fluid visualization column. The Memory graph
occupies the visualization column; the Decision Trace spans the complete row
below it. Both visualization panels receive a usable minimum height so their
canvases have room to render. Below the large-screen breakpoint, the layout
becomes one column without horizontal overflow.

## Acceptance criteria

- The workspace content exposes a stable layout hook for a UI test.
- At `lg` and above, the graph column is fluid and wider than the notes column.
- The Decision Trace spans both desktop columns.
- The page retains its existing workspace selection and bridge requests.
- The GUI typecheck and focused Memory page test pass.
