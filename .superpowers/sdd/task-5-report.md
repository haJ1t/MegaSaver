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

- Focused benchmark Node suite: 6/6 files and 25/25 tests passed with zero type
  errors.
- Long-memory package under root verification: 39/39 files and 334/334 tests
  passed with zero type errors.
- Python official-base/installer/LM0 suites: 25/25 passed using Python 3.11,
  the pinned official checkout at commit
  `6f020ac2fc3275e46c706d3406e02c3ed79b7be2`, and the real built Node
  transport; `py_compile` passed.
- Standalone package build and package typecheck passed.
- Root `pnpm verify` passed all 56 Turbo tasks, lint checked 1,631 files, and
  every managed conventions check passed.
- `git diff --check` passed. Touched source/test/fixture files are at or below
  300 lines; the Python backend is 296 lines and the largest test is 272.

## Environment boundary

The pinned official source checkout and real official `Memory` base were
available locally. This task did not download or execute the full official
LongMemEval-V2 dataset, reader, judge, dashboard, or submission builders; those
are Task 6 evidence gates. No official score or score-equivalence claim is
made. Fresh independent benchmark-contract re-review remains required.
