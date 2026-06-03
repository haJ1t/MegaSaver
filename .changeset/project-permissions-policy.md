---
"@megasaver/policy": minor
---

Add project permissions (`.megasaver/permissions.yaml`) support to the policy gate.

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
