import { describe } from "vitest";
// WHY: symlink creation needs elevation on Windows (EPERM) and NTFS ignores
// POSIX chmod mode bits, so these POSIX-semantics tests cannot run there.
// Skipping loses no Windows-relevant coverage (the guarded behaviors are
// POSIX-only). The skip is explicit so it is never mistaken for coverage.
export const describeUnlessWindows = process.platform === "win32" ? describe.skip : describe;
