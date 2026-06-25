import { describe } from "vitest";
// WHY: NTFS ignores POSIX chmod mode bits, so the file-permission assertions
// here cannot run on Windows. Skipping loses no Windows-relevant coverage (the
// guarded behavior is POSIX-only). Explicit so it is never mistaken for coverage.
export const describeUnlessWindows = process.platform === "win32" ? describe.skip : describe;
