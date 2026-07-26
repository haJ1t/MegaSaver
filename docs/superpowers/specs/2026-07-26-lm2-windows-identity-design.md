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
