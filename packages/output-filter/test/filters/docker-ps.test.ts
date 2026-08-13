import { describe, expect, it } from "vitest";
import { compressDockerPs } from "../../src/filters/docker-ps.js";
import { COMMAND_FILTERS } from "../../src/filters/index.js";
import { assertFilterConformance } from "./conformance.js";

const filter = COMMAND_FILTERS.find((f) => f.name === "docker-ps");
if (filter === undefined) throw new Error("docker-ps not registered");

const HEADER =
  "CONTAINER ID   IMAGE          COMMAND                  CREATED       STATUS       PORTS                    NAMES";
const row = (id: string, image: string, name: string): string =>
  `${id}   ${image.padEnd(12)}   "docker-entrypoint.s…"   2 hours ago   Up 2 hours   0.0.0.0:8080->8080/tcp   ${name}`;
const PS = [
  HEADER,
  row("3f8a12bc9d01", "postgres:16", "ms-db"),
  ...Array.from({ length: 8 }, (_, i) => row(`aa00000000${i}0`, "app:latest", `app-${i}`)),
  row("9c7b44de0e21", "redis:7", "ms-cache"),
].join("\n");

describe("docker-ps filter", () => {
  it("folds consecutive same-image rows beyond the cap", () => {
    const out = assertFilterConformance(filter, PS);
    expect(out).toContain(HEADER);
    expect(out).toContain("app-2");
    expect(out).not.toContain("app-3");
    expect(out).toContain("… [5 similar: app:latest]");
    expect(out).toContain("ms-cache");
  });

  it("passes non-table text through verbatim", () => {
    expect(compressDockerPs("Error response from daemon: dial unix")).toBe(
      "Error response from daemon: dial unix",
    );
  });

  it("never folds anomalous rows — crashed and restarting containers survive", () => {
    const PS_ANOMALY = [
      HEADER,
      row("3f8a12bc9d01", "postgres:16", "ms-db"),
      ...Array.from({ length: 6 }, (_, i) => row(`aa00000000${i}0`, "app:latest", `app-${i}`)),
      `${"bb1111111111"}   ${"app:latest".padEnd(12)}   "docker-entrypoint.s…"   2 hours ago   Exited (1) 5 minutes ago   0.0.0.0:8080->8080/tcp   app-crashed`,
      `${"cc2222222222"}   ${"app:latest".padEnd(12)}   "docker-entrypoint.s…"   2 hours ago   Restarting (2) 10 seconds ago   0.0.0.0:8080->8080/tcp   app-restarting`,
    ].join("\n");
    const out = compressDockerPs(PS_ANOMALY);
    expect(out).toContain("Exited (1) 5 minutes ago");
    expect(out).toContain("Restarting (2) 10 seconds ago");
    expect(out).toContain("app-crashed");
    expect(out).toContain("app-restarting");
    expect(out).toContain("… [3 similar: app:latest]");
  });

  it("passes rows without an image column through verbatim", () => {
    const PS_BROKEN = [HEADER, "3f8a12bc9d01", "9c7b44de0e21", "aa00000000f0", "bb00000000f1"].join(
      "\n",
    );
    const out = compressDockerPs(PS_BROKEN);
    expect(out).toBe(PS_BROKEN);
  });
});
