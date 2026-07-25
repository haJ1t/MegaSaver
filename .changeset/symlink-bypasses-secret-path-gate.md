---
"@megasaver/output-filter": minor
"@megasaver/context-gate": patch
---

fix: apply the secret-path denylist to the symlink-resolved read target

The two-gate read matched `SECRET_PATH_PATTERNS` against the caller's literal
path (`normalizePath` is a pure string op — no filesystem access) but read
through `fs.readFile`, which follows symlinks. Gate 2 (`resolveSafeReadPath`)
computed a realpath only to test sandbox *containment* against
`[projectRoot, cwd, homedir()]` and then returned the un-resolved lexical path,
so the denylist was never applied to the file actually opened.

Before: with `ln -s ~/.aws cfg` checked into a repo, `proxy_read_file({path:
"cfg/credentials"})` returned `{ok: true}` and the credential file's contents;
`ln -s ~/.ssh keys` + `keys/config` returned the whole ssh config in cleartext
with 0 redactions. No `blocked-read` firewall event was recorded, because the
deny branch never fired. Control reads of the same bytes via
`<home>/.aws/credentials` correctly returned `path_denied` /
`secret_path_read`.

After: all three shapes (directory symlink, plain file symlink, direct path)
return `{ok: false, code: "path_denied", reason: "secret_path_read"}` on both
`runTwoGates` and `runOverlayTwoGates`, so the firewall ledger records them.
Ordinary in-sandbox reads are unaffected.

`resolveSafeReadPath` now returns the realpath it already computed as
`real` alongside `absolute` (additive field on the exported `ResolvedPath`).
