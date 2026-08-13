import { describe, expect, it } from "vitest";
import { COMMAND_FILTERS } from "../../src/filters/index.js";
import { compressNpmInstall } from "../../src/filters/npm-install.js";
import { assertFilterConformance } from "./conformance.js";

const filter = COMMAND_FILTERS.find((f) => f.name === "npm-install");
if (filter === undefined) throw new Error("npm-install not registered");

const PNPM = [
  "Lockfile is up to date, resolution step is skipped",
  "Packages: +1247",
  "+".repeat(60),
  ...Array.from(
    { length: 40 },
    (_, i) => `Progress: resolved ${i * 30}, reused ${i * 28}, downloaded ${i}, added ${i * 30}`,
  ),
  "Progress: resolved 1247, reused 1180, downloaded 67, added 1247, done",
  "",
  "devDependencies:",
  "+ vitest 3.0.5",
  "",
  " WARN  deprecated glob@7.2.3",
  "Done in 24.8s",
].join("\n");

describe("npm-install filter", () => {
  it("drops progress noise, keeps the final totals line and warnings", () => {
    const out = assertFilterConformance(filter, PNPM);
    expect(out).toContain("Progress: resolved 1247, reused 1180, downloaded 67, added 1247, done");
    expect(out).not.toContain("Progress: resolved 30,");
    expect(out).toContain(" WARN  deprecated glob@7.2.3");
    expect(out).toContain("Done in 24.8s");
    expect(out).toContain("… [41 progress lines]");
  });

  it("passes clean short output through verbatim", () => {
    const quiet = "added 3 packages in 1.2s";
    expect(compressNpmInstall(quiet)).toBe(quiet);
  });

  it("passes composite-command output through verbatim (shape guard)", () => {
    const dockerRun = [
      "Unable to find image 'node:22-alpine' locally",
      "node:22-alpine: Pulling from library/node",
      "9c7b44de0e21: Pulling fs layer",
      "9c7b44de0e21: Verifying Checksum",
      "9c7b44de0e21: Download complete",
      "Status: Downloaded newer image for node:22-alpine",
    ].join("\n");
    expect(compressNpmInstall(dockerRun)).toBe(dockerRun);
  });
});
