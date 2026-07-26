import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join, posix } from "node:path";

function fail(message) {
  throw new Error(message);
}

export function verifyRecordedArchive(packageRoot, archive, files) {
  const prefix = basename(packageRoot);
  const members = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
    .split(/\r?\n/u)
    .filter(Boolean);
  for (const name of members) {
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
    const listing = execFileSync("tar", ["-tvzf", archive, name], { encoding: "utf8" });
    if ((directory && !listing.startsWith("d")) || (!directory && !listing.startsWith("-"))) {
      fail(`Recorded tar member has an unsafe type: ${name}`);
    }
  }
  const regularMembers = members.filter((name) => !name.endsWith("/"));
  const expected = files.map((name) => `${prefix}/${name}`).sort();
  if (JSON.stringify([...regularMembers].sort()) !== JSON.stringify(expected)) {
    fail("Recorded tar inventory differs from the package.");
  }
  for (const name of expected) {
    const archived = execFileSync("tar", ["-xOzf", archive, name]);
    if (!archived.equals(readFileSync(join(packageRoot, name.slice(prefix.length + 1))))) {
      fail(`Recorded tar bytes differ from the package: ${name}`);
    }
  }
}
