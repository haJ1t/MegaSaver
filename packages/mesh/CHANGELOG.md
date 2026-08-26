# @megasaver/mesh

## 0.2.1

### Patch Changes

- Updated dependencies [297f9ac]
  - @megasaver/shared@1.3.2
  - @megasaver/policy@2.1.1

## 0.2.0

### Minor Changes

- db91dd3: Add Session Mesh Family (A1→A5) — local, file-backed session mesh.

  New leaf package `@megasaver/mesh` (files are truth, `store/mesh/`): presence register/heartbeat/listPeers/gc/events, at-most-once inbox (redacted, bounded drain), advisory claims (TTL 30m, repo-family scoping, glob via NFA), structured board (post/list/resolve/promote, disputed/supersede, TTL, 500-token injection), peer Q&A routing (`mesh_send` kind ask/answer, 60s rate-limit, keyword hint ≥3 overlap ≤200/30m ≤500 chars), handoff capability (`HandoffCapabilityProfile` on every `ConnectorTarget`, `evaluateHandoffFit` measured on rendered block, `open` strict vs `--fit`, `peers`/`offer` pointer-only). CLI `mega mesh {status,send,ask,answer,claims,events,gc}`, `mega board {post,list,resolve,promote}`, `mega handoff {peers,offer}` + `open --fit` / `pack` advisory, MCP 10 tools (`mesh_*` 7 + `board_*` 3) + `handoff-offer` bus kind, hooks (warmup register, saver heartbeat fire-and-forget ≥5s, guard conflict+inbox inject bounded 5/2000, board digest/delta 500/30s, `mesh-hint` opt-in `--mesh-hints`), daemon `GET /mesh/status` accelerator. All writes atomic tmp+rename 0600/0700, torn lines skipped/quarantined, every hook catch→exit 0, every user text through `redact()` before persist, advisory-only (warn, never block).
