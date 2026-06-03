---
"@megasaver/context-gate": minor
---

Load and enforce project permissions (`.megasaver/permissions.yaml`).

New public API: `loadProjectPermissions(projectRoot): ProjectPermissions | null`
— synchronously reads `<projectRoot>/.megasaver/permissions.yaml`, parses it with
the new `yaml@^2` dependency (safe-by-default `parse`, no custom tags / code-exec),
and delegates validation to the pure `policy.parseProjectPermissions`. An absent
file returns `null` (baseline only); every other failure mode (non-ENOENT fs error,
YAML syntax error, schema violation) becomes a single typed `PolicyLoadError` —
fail-closed.

`resolveEffectiveSettings` now loads the permissions once per resolve (via an
injectable loader, default = the real fn) and returns a discriminated
`ResolveResult` (`session_not_found` | `policy_load_failed` | `ok`); `EffectiveSettings`
carries the loaded `ProjectPermissions | null`, threaded into `evaluateCommand`
and `runTwoGates`. A present-but-malformed file denies the operation in resolve,
before any spawn or `fs.readFile`. Adds the `yaml@^2` runtime dependency.
