---
"@megasaver/policy": patch
---

Close the home credential-store leak on both layers.

`resolveSafeReadPath` admits `homedir()` as a sandbox root, so the LOCKED
secret-path denylist is the only thing between an agent and every credential
file under `$HOME` — and it did not list them all. Five globs appended
(`**/.pgpass`, `**/pgpass.conf`, `**/.docker/config.json`, `**/.kube/config`,
`**/.config/gh/hosts.yml`), taking the table from 19 to 24. All three consumers
of `evaluatePathRead` are fixed by that one amendment: the read gates,
`evaluateCommand`'s arg scan (`cat ~/.pgpass` was ALLOWED) and
`handoff-export`'s hunk filter.

Three redaction detectors appended for the same carriers arriving by another
route — `npmrc_auth`, `pgpass_line`, `kubeconfig_token`. All file-level globs
and bounded patterns; `.kube/cache`, `.docker/daemon.json` and
`.config/gh/config.yml` stay readable.

`npmrc_auth` also matches the QUOTED value `npm config set` writes (its ini
serializer quotes anything containing `=`, i.e. base64 padding) — without that
the `~/.npmrc` line the detector exists for was skipped entirely, which is the
whole reason `.npmrc` is allowed to stay off the denylist. `pgpass_line` and
`kubeconfig_token` now gate on value SHAPE and anchor to end of line, so they
no longer destroy ordinary colon-delimited log lines or `token:` fields in
source code.

No public API change.
