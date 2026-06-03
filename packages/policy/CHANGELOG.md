# @megasaver/policy

## 1.1.0

### Minor Changes

- bb3d179: Add project permissions (`.megasaver/permissions.yaml`) support to the policy gate.

  New public API: the pure `parseProjectPermissions(raw: unknown): ProjectPermissions`
  (zod `.strict()` validation + glob compilation, no fs/yaml — zero new runtime
  deps), its `projectPermissionsSchema`, the compiled `ProjectPermissions` type, and
  the typed `PolicyLoadError`. `evaluateCommand` and `evaluatePathRead` each gain an
  optional `permissions?: ProjectPermissions` applied as an additional, tighten-only
  deny gate after the baseline chain (a `deny.commands` match → `command_not_allowed`;
  a `deny.read` glob match → `secret_path_read`). The `policyDenyCodeSchema` closed
  enum gains a seventh member, `policy_load_failed` (alphabetic, between `path_denied`
  and `recursive_megasaver`), emitted by the orchestrator on a present-but-malformed
  file.

  Tighten-only by construction: there is no `allow:` key and no field that subtracts
  from a baseline list, so a project file can only ADD denials — it can never
  re-allow a `DANGEROUS_PATTERNS` hit, add to `ALLOWED_COMMANDS`, or un-deny a
  `SECRET_PATH_PATTERNS` entry. Invalid shape (incl. a stray `allow:` or any unknown
  key) throws `PolicyLoadError` — fail-closed, never a silent ignore.

## 1.0.0

### Major Changes

- b7f35e3: Mega Saver v1.0 — Context Gate / Mega Saver Mode.

  Session-scoped, GUI-controlled, MCP-backed output compression ships
  complete: the `tokenSaver` session setting, the Context Gate
  orchestrator, the output-filter redaction/ranking pipeline, the
  content store, retrieval (BM25) and stats packages, the real
  `@megasaver/mcp-bridge` over stdio with four tools, the GUI
  TokenSaverPanel + Agent Setup Doctor, and the additive
  `MEGA SAVER:CONTEXT_GATE` connector instruction block. One click
  enables token saving per session; raw evidence stays local; the agent
  receives only the most relevant excerpts with measurable byte savings.

### Minor Changes

- 61efb28: Add the `@megasaver/policy` security gate package: `evaluateCommand`
  (allow-list + dangerous-pattern + `MEGASAVER_ORIGIN_PID` re-entry guard),
  `evaluatePathRead` (secret-path denylist), `redact` (baseline secret
  redaction), and the closed alphabetic `policyDenyCodeSchema` /
  `PolicyDenyCode` enum.

### Patch Changes

- Updated dependencies [93840ac]
- Updated dependencies [b7f35e3]
- Updated dependencies [0498b79]
- Updated dependencies [4a56e4c]
  - @megasaver/shared@1.0.0
