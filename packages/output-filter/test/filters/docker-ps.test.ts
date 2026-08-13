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
});
