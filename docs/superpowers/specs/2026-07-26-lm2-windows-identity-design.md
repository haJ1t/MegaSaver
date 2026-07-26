# LM2 Windows lossless filesystem identity design

**Risk:** HIGH — durable memory catalog locks, benchmark state, and evidence
validation must reject pathname replacement without turning valid Windows
stores into false corruption.

## Context

The first Windows filesystem repair removed unsupported POSIX open flags and
directory `fsync`. Replacement CI `30211975610` then showed that LM2 still
assumed POSIX semantics in three independent places: NTFS does not represent
owner/group mode bits, the benchmark verifier's absolute-artifact schema only
accepted `/` paths, and catalog control serialized `Stats.dev`/`Stats.ino` as
safe JavaScript numbers. A Windows `FILE_ID` may exceed number precision, so
the latter must not be relaxed or ignored. (source: CI `30211975610`,
Node `fs.Stats` BigInt API, Libuv `uv_stat_t`)

## Options considered

1. Skip LM2 on Windows or skip the affected tests. Rejected: Windows is a
   supported product platform and a skipped durable-memory suite would hide
   the failure.
2. Keep number identities but remove the safe-number guard. Rejected: rounded
   file IDs can alias a replacement path and defeat the lock binding.
3. Use lossless `BigIntStats` identities at every durable lock comparison,
   serialize the device/file ID as canonical nonnegative decimal strings, and
   isolate platform-only mode/directory-durability checks. Accepted.

The user granted autonomous scope and decisions for reaching a fully working
product; this document records that approval for this release-blocking repair.

## Design

### Lossless durable-lock identity

`lm2-catalog-lock.ts` and `lm2-lock.ts` read all durable-lock
`fstat`/`lstat` observations with `{ bigint: true }`. They store only the
canonical decimal text of `dev` and `ino` in `Lm2CatalogControl`, workspace
lock guards, operation fences, and quota ledgers; none converts them through
`Number`. Every subsequent descriptor/path/control comparison uses that exact
text plus the existing random token. Invalid, negative, or noncanonical
strings remain a fail-closed `store_corrupt` condition. The public catalog API
and receipts do not change.

This fixes Windows precision without weakening POSIX replacement detection.
The broader anchored-storage checks retain their current `fstat`/`lstat`
semantics; the lock guards add a lossless identity confirmation where an ID
crosses a process boundary.

### Existing durable state

Existing canonical V2 catalog controls and V1 quota ledgers may contain
numeric device/inode fields. The parser accepts this legacy shape only when
each numeric identity is a nonnegative safe integer and the raw JSON is
canonical. It immediately normalizes the in-memory value to decimal text;
the next quota-ledger write rewrites it in the new form. Values outside the
safe range fail closed because their original identity cannot be recovered.
This is a narrow persisted-state transition, not a permissive parser or a
general backward-compatibility layer.

### Platform capability boundary

`lm2-fs-platform.ts` owns two additional pure decisions: whether an exact
POSIX mode is enforceable and whether a path has an absolute-artifact shape.
Exact `0700`/`0600` mode checks remain mandatory on non-Windows platforms and
are not asserted on Windows, where Node documents only a write-bit model.
Regular-file type, link, owner where available, descriptor/path identity, and
token checks remain mandatory everywhere.

The evidence schema accepts either a POSIX absolute path or a drive-rooted
Windows absolute path. The runtime verifier still calls the host `isAbsolute`
and hashes the referenced executable, so permitting the schema spelling does
not authorize a relative or unbound executable.

### Windows directory handles

Node cannot acquire a POSIX-style file descriptor for a directory on Windows.
For benchmark directories only, the safe-path boundary therefore captures a
lossless BigInt device/file identity both before and immediately after
acquiring a `Dir` handle, rejecting any difference, then retains the pre-open
identity. It rechecks
the current pathname's type, symlink status, mode capability, and exact
identity before and after each guarded operation; the run lock remains a
regular descriptor-backed, advisory-locked file. Directory metadata `fsync`
is omitted only where the platform does not support it. A pathname replacement
is still rejected before further publication.

### Windows regular-file flags and child completion

The safe-path boundary retains `O_NONBLOCK` for POSIX regular-file opens so a
named pipe cannot stall benchmark admission. Windows does not support that
flag for this operation, so its regular-file path omits only `O_NONBLOCK` and
continues to require the existing file type, link, owner, mode-capability,
and exact identity checks after open. Catalog process fixtures finish by
natural event-loop drain instead of calling `process.exit()` immediately after
writing their JSON result; this preserves the result across Windows pipe
buffering without changing catalog behavior.

### Durable benchmark writes

Windows CI showed that opening a newly written benchmark state file as
read-only and then calling `fsync` can reject an otherwise valid run. The
exclusive state writer therefore reopens `sentinel.json`, `control.json`, and
the control replacement temporary using the existing `update` safe-path mode
before `fsync`. This changes no pathname, object, link, mode, or identity
validation: it only gives the durable-write flush a writable regular-file
descriptor. Read-only paths remain read-only, and POSIX behavior is unchanged.

### Archive listings and child result flush

Windows `tar` emits CRLF text listings, so archive member parsing canonicalizes
line endings before using a member name as a second `tar` argument or comparing
it to the package inventory. The catalog child also awaits the completion
callback for its final JSON write; signalling writes remain synchronous where a
test deliberately pauses the child before the guarded operation. This makes
the final result observable without weakening lock/replacement assertions.

### Catalog fixture stream completion

The parent-side catalog test fixture treats a child process exit and its stdout
stream completion as separate facts. It parses the terminal JSON result only
after both have occurred: Windows can schedule the process `close` callback
before the final buffered stdout data callback. This is test-protocol ordering
only; catalog locking, replacement detection, and production persistence code
remain unchanged.

### Evidence package inventory names

The official evidence package is a logical artifact tree, not a host-native
path API. The verifier therefore canonicalizes every walked relative package
name and every package-directory prefix to `/` before comparing them with the
manifest references. Native `join` and `relative` remain limited to filesystem
access. This preserves the evidence schema's portable artifact spelling and
stops a valid Windows package from being rejected solely because Node returned
`\\` while the signed evidence correctly contains `/`.

### Test and fixture portability

Tests that observe directory `fsync` assert it only where directory sync is a
supported contract. Builder setup executes `pnpm.cmd` on Windows. Test child
protocols parse only their JSON payload rather than assuming POSIX child output
shape. Symlink and chmod threat tests retain their existing Windows guards;
there is no broad suite exclusion.

## Acceptance evidence

1. Red tests prove catalog control and quota ledger accept lossless identities
   larger than `Number.MAX_SAFE_INTEGER`, safely read canonical legacy
   identities, and reject noncanonical or unsafe legacy values.
2. A red test proves Windows mode capability accepts an NTFS-style mode while
   POSIX still rejects it; POSIX secure-flag behavior remains covered.
3. Benchmark open/insert/query, catalog recovery/replacement, and completion
evidence tests pass on both operating systems.
4. `pnpm verify` passes locally, a fresh independent reviewer approves, and
   replacement Ubuntu and Windows CI plus bundle smoke pass before merge.
5. Windows-simulated directory-handle tests prove successful opening without
   a directory descriptor, rejection of a later pathname replacement, and
   rejection of an adversarial replacement between pre-open and post-open
   BigInt identity captures; the real Windows CI exercises the same production
   branch.
6. A red flag-selection test proves Windows omits only unsupported
   `O_NONBLOCK`, while POSIX retains it; catalog replacement-writer fixtures
   return their complete result on both platforms.
7. A red durable-write test observes the former read-only open and requires
   the exclusive writer to use its update descriptor before durability flush.
8. A Windows CI completion-gate run accepts the portable package inventory;
   POSIX runs continue to compare the same canonical `/` artifact names.
9. A Windows CI run accepts recorded tar listings and drains a signalled child
   result without an omitted or partial JSON payload.
10. Fixture regressions prove direct, barrier, and signalled appenders tolerate
    a child `close` event that precedes the final stdout result; the real
    Windows catalog-process suite preserves both concurrent appends.
