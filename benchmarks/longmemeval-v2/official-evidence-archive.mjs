import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, posix } from "node:path";

function fail(message) {
  throw new Error(message);
}

// Windows ships bsdtar as `tar.exe`, and its member-pattern matching rejects
// the trailing-slash directory form (`tar -tvzf a.tgz pkg/`) that GNU tar and
// macOS bsdtar accept — the gate failed there with a bare "Command failed".
// Rather than chase the quirk, nothing here selects members by pattern any
// more: one listing pass and one extraction pass, both whole-archive.
//
// That also drops the tar invocations from O(members + files) to 3. This
// function ran ~40 subprocesses per call, and process spawn is expensive on
// Windows; the test carrying it took over two minutes there.
export function verifyRecordedArchive(packageRoot, archive, files) {
  const prefix = basename(packageRoot);
  const members = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
    .split(/\r?\n/u)
    .filter(Boolean);
  // `-tzf` and `-tvzf` both read the archive sequentially, so index i names the
  // same member in both. Correlating by position avoids parsing the name out of
  // the verbose format, whose column layout is not stable across tar builds.
  const verbose = execFileSync("tar", ["-tvzf", archive], { encoding: "utf8" })
    .split(/\r?\n/u)
    .filter(Boolean);
  if (verbose.length !== members.length) fail("Recorded tar listing is inconsistent.");
  for (const [index, name] of members.entries()) {
    const directory = name.endsWith("/");
    const normalizedName = directory ? name.slice(0, -1) : name;
    const segments = normalizedName.split("/");
    if (
      !normalizedName ||
      normalizedName.startsWith("/") ||
      posix.normalize(normalizedName) !== normalizedName ||
      segments.includes(".") ||
      segments.includes("..") ||
      segments.includes("") ||
      segments[0] !== prefix
    ) {
      fail("Recorded tar contains an unsafe path.");
    }
    // The per-member form listed the directory AND everything under it, so only
    // the first line was ever inspected and a nested member's type went
    // unchecked. Each member is now typed from its own row.
    const type = verbose[index]?.[0];
    if ((directory && type !== "d") || (!directory && type !== "-")) {
      fail(`Recorded tar member has an unsafe type: ${name}`);
    }
  }
  const regularMembers = members.filter((name) => !name.endsWith("/"));
  const expected = files.map((name) => `${prefix}/${name}`).sort();
  if (JSON.stringify([...regularMembers].sort()) !== JSON.stringify(expected)) {
    fail("Recorded tar inventory differs from the package.");
  }
  // Every path was validated above before anything is written to disk.
  const extractRoot = mkdtempSync(join(tmpdir(), "megasaver-lm2-archive-"));
  try {
    execFileSync("tar", ["-xzf", archive, "-C", extractRoot]);
    for (const name of expected) {
      const relative = name.slice(prefix.length + 1);
      if (
        !readFileSync(join(extractRoot, prefix, relative)).equals(
          readFileSync(join(packageRoot, relative)),
        )
      ) {
        fail(`Recorded tar bytes differ from the package: ${name}`);
      }
    }
  } finally {
    rmSync(extractRoot, { recursive: true, force: true });
  }
}
