# LM2 Completion Task 5 Report

## Scope

Implemented and hardened the separate LongMemEval-V2 backend, manifest builder,
official-checkout installer, and stateless benchmark transport. The benchmark
entry remains a separate executable and is not exported from the production
package root. Task 6 evidence/scoring work was not started.

## TDD and review evidence

- Initial RED covered canonical vectors, manifest construction, stateless
  `open/insert/query`, synchronous indexing, question/chain admission,
  filesystem rejection, Python official-base lifecycle, and installer state.
- Review RED proved a replacement `run.lock` pathname was accepted both before
  a later operation and after flock acquisition before a control write.
- Review RED proved medium/small haystack checksum substitution was accepted.
- Review RED proved Python scientific-number canonical bytes diverged from the
  TypeScript path at `1e-7`, `1e-6`, and `1e21`.
- Review RED proved self-consistent official commit/repository/checksum/tier,
  row-shape, and question-chain substitutions reached transport.
- Closure RED proved malformed projection timestamps, empty question IDs, and
  malformed local model descriptors passed Python admission before transport.
- Closure RED also proved pre-open rejected queries had no durable telemetry,
  while FIFO and cache-parent replacement could reach the old pathname-based
  writer without a fail-closed identity boundary.
- Final closure RED proved rejected telemetry persisted a raw untrusted
  `question_id`, and load adopted state while another process held the run
  flock. A deterministic replacement during the locked-state read also proved
  the old lock pathname was not revalidated before adoption.
- Review RED proved a symlink alias of the original save directory loaded.
  The same state matrix now rejects corrupt control literals, empty-chain
  replay, a foreign trajectory digest, and a copied replacement run root.
- Final packaging RED ran the normal, non-contract manifest builder after a
  package build and proved its two internal imports were absent from `dist/`.
  The builder now consumes emitted private manifest/canonical entrypoints while
  the package-root export and both existing bins remain unchanged.
- Final identity RED proved both TypeScript and Python accepted a syntactically
  valid UUIDv5 derived from a foreign trajectory/source/index frame. Both
  admission paths now recompute the exact namespace UUIDv5 over
  `trajectoryId + NUL + sourceKind + NUL + decimalSourceIndex`; a fixed vector
  proves the same bytes and result across languages, and the Python mutation
  remains zero-transport.
- Ultimate corpus RED reproduced released enterprise trajectory `096432bf`,
  `states[12]`: the 70,126-character accessibility tree has U+0020 at UTF-16
  code unit 50,000, so truncation after the original trim exposed trailing
  whitespace and embedding admission failed. Projection text is now NFC/trim
  canonicalized after bounded surrogate-safe truncation. The final 49,999-code-
  unit text preserves the deterministic projection UUID and derives its
  embedding digest from those exact final bytes.
- GREEN adds descriptor/path identity checks around the fixed lock, validates
  the locked inode before state writes, and fsyncs the run directory after the
  atomic control rename. The Python backend validates the pinned V1 fields and
  invariants needed for runtime admission—including timestamp grammar, nonempty
  question IDs, row/digest bindings, and exact local-model limits—and validates
  complete saved/run control identity before adopting state.
- Rejected queries now create a separate durable, redacted telemetry stream
  before any transport run exists. Component-anchored directory traversal,
  nonblocking no-follow file opens, link/mode/owner checks, and before/after
  descriptor-path identity checks reject FIFO or parent substitution. The
  stream omits raw question/context data and retains only a reason, canonical
  timestamp, random audit ID, and bounded aggregate metadata.
- Load acquires the real run flock nonblocking before reading run state, binds
  sentinel/control values to that descriptor, and revalidates lock/run
  descriptor-path identity immediately before adoption. Busy or replaced state
  fails before transport; every success and failure path releases the flock.
- The fixed TypeScript numeric vector is shared with Python, and the real built
  transport accepts a full trajectory containing `1e-7` and `1e20`, proving the
  full-object digest across the language boundary.

## Verification

- Focused benchmark Node suite: 6/6 files and 28/28 tests passed with zero type
  errors.
- Long-memory package under root verification: 39/39 files and 337/337 tests
  passed with zero type errors.
- Python official-base/installer/LM0 suites: 26/26 passed using Python 3.11,
  the pinned official checkout at commit
  `6f020ac2fc3275e46c706d3406e02c3ed79b7be2`, and the real built Node
  transport; `py_compile` passed.
- Standalone package build and package typecheck passed.
- The released revision was downloaded with the pinned checkout's official
  script. Every required data checksum matched. Official screenshot preparation
  materialized 1,913 trajectory directories, and unmodified validation passed
  for Small with screenshot checks enabled: 451 questions, 1,870 trajectories.
  The README builder command for enterprise/Small produced an 89-MiB canonical
  manifest with digest
  `08e0b3f9d2715ada52f17cfe77a796b93f6cdfd79a07c79de43ea0344b15a7ae`.
  It emitted 211 questions and 100 trajectories; `096432bf` was trajectory
  index 3 with a canonical 49,999-unit `states[12]`, and index 4 proved the
  builder continued beyond the former blocker.
- Root `pnpm verify` passed all 56 Turbo tasks, lint checked 1,631 files, and
  every managed conventions check passed.
- `git diff --check` passed. Touched source/test/fixture files are at or below
  300 lines; the Python backend is 299 lines and the largest touched test is
  281.

## Environment boundary

The pinned official source checkout and real official `Memory` base were
available locally. This task downloaded the released data snapshot and executed
only its preparation, validation, and manifest-building path to close a Task 5
corpus blocker. It did not execute the official harness, reader, judge,
dashboard, or submission builders; those remain Task 6 evidence gates. No
official score or score-equivalence claim is made. Fresh independent
benchmark-contract re-review remains required.
