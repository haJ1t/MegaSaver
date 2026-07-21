import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

function fail(message) {
  throw new Error(message);
}

export function verifyRecordedArchive(packageRoot, archive, files) {
  const prefix = basename(packageRoot);
  const members = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
    .split("\n")
    .filter((name) => name && !name.endsWith("/"));
  const expected = files.map((name) => `${prefix}/${name}`).sort();
  if (JSON.stringify([...members].sort()) !== JSON.stringify(expected)) {
    fail("Recorded tar inventory differs from the package.");
  }
  for (const name of expected) {
    if (name.startsWith("/") || name.split("/").includes("..")) {
      fail("Recorded tar contains an unsafe path.");
    }
    const listing = execFileSync("tar", ["-tvzf", archive, name], { encoding: "utf8" });
    if (!listing.startsWith("-")) fail(`Recorded tar member is not regular: ${name}`);
    const archived = execFileSync("tar", ["-xOzf", archive, name]);
    if (!archived.equals(readFileSync(join(packageRoot, name.slice(prefix.length + 1))))) {
      fail(`Recorded tar bytes differ from the package: ${name}`);
    }
  }
}
