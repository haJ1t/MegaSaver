import { describe, expect, it } from "vitest";
import { compressDockerBuild } from "../../src/filters/docker-build.js";
import { COMMAND_FILTERS } from "../../src/filters/index.js";
import { assertFilterConformance } from "./conformance.js";

const filter = COMMAND_FILTERS.find((f) => f.name === "docker-build");
if (filter === undefined) throw new Error("docker-build not registered");

const sha = (n: number): string => n.toString(16).padStart(12, "0");
const BUILD = [
  "#1 [internal] load build definition from Dockerfile",
  "#1 transferring dockerfile: 1.24kB done",
  "#1 DONE 0.1s",
  "#2 [internal] load metadata for docker.io/library/node:22-alpine",
  "#2 DONE 0.8s",
  "#3 [1/5] FROM docker.io/library/node:22-alpine",
  ...Array.from({ length: 18 }, (_, i) => `#3 sha256:${sha(0xabc0 + i)}deadbeef00 4.19MB / 4.19MB done`),
  ...Array.from({ length: 6 }, (_, i) => `#3 extracting sha256:${sha(0xfff0 + i)}cafe00 0.5s done`),
  "#3 DONE 6.4s",
  "#4 [2/5] WORKDIR /app",
  "#4 CACHED",
  "#5 [3/5] COPY package.json pnpm-lock.yaml ./",
  "#5 DONE 0.1s",
  "#6 [4/5] RUN corepack enable && pnpm install --frozen-lockfile",
  "#6 12.31 Lockfile is up to date, resolution step is skipped",
  "#6 14.02  WARN  deprecated glob@7.2.3",
  "#6 DONE 31.2s",
  "#7 [5/5] COPY . .",
  "#7 DONE 0.3s",
  "#8 exporting to image",
  "#8 writing image sha256:1f2e3d4c5b6a7980deadbeefcafe0123 done",
  "#8 naming to docker.io/library/megasaver:dev done",
  "#8 DONE 0.9s",
].join("\n");

describe("docker-build filter", () => {
  it("drops layer transfer noise, keeps steps, run output and result", () => {
    const out = assertFilterConformance(filter, BUILD);
    expect(out).toContain("#6 [4/5] RUN corepack enable && pnpm install --frozen-lockfile");
    expect(out).toContain("#6 14.02  WARN  deprecated glob@7.2.3");
    expect(out).toContain("#4 CACHED");
    expect(out).toContain("#8 writing image sha256:1f2e3d4c5b6a7980deadbeefcafe0123 done");
    expect(out).not.toContain("4.19MB / 4.19MB");
    expect(out).toContain("… [25 layer lines]");
  });
});
