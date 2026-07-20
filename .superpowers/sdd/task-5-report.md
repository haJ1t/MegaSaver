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
- Review RED proved a symlink alias of the original save directory loaded.
  The same state matrix now rejects corrupt control literals, empty-chain
  replay, a foreign trajectory digest, and a copied replacement run root.
- GREEN adds descriptor/path identity checks around the fixed lock, validates
  the locked inode before state writes, and fsyncs the run directory after the
  atomic control rename. The Python backend validates the exact canonical V1
  contract before runtime transport admission and validates complete saved/run
  control identity before adopting state.
- The fixed TypeScript numeric vector is shared with Python, and the real built
  transport accepts a full trajectory containing `1e-7` and `1e20`, proving the
  full-object digest across the language boundary.

## Verification

- Focused benchmark Node suite: 6/6 files and 25/25 tests passed with zero type
  errors.
- Long-memory package under root verification: 39/39 files and 334/334 tests
  passed with zero type errors.
- Python official-base/installer/LM0 suites: 18/18 passed using Python 3.11,
  the pinned official checkout at commit
  `6f020ac2fc3275e46c706d3406e02c3ed79b7be2`, and the real built Node
  transport; `py_compile` passed.
- Standalone package build and package typecheck passed.
- Root `pnpm verify` passed all 56 Turbo tasks, lint checked 1,631 files, and
  every managed conventions check passed.
- `git diff --check` passed. Touched source/test/fixture files are below 300
  lines; the largest are the Python backend at 298 and its test at 290.

## Environment boundary

The pinned official source checkout and real official `Memory` base were
available locally. This task did not download or execute the full official
LongMemEval-V2 dataset, reader, judge, dashboard, or submission builders; those
are Task 6 evidence gates. No official score or score-equivalence claim is
made. Fresh independent benchmark-contract re-review remains required.
