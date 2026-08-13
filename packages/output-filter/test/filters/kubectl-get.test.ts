import { describe, expect, it } from "vitest";
import { COMMAND_FILTERS } from "../../src/filters/index.js";
import { compressKubectlGet } from "../../src/filters/kubectl-get.js";
import { assertFilterConformance } from "./conformance.js";

const filter = COMMAND_FILTERS.find((f) => f.name === "kubectl-get");
if (filter === undefined) throw new Error("kubectl-get not registered");

const pod = (name: string, ready: string, status: string, restarts: string, age: string): string =>
  `${name.padEnd(28)}${ready.padEnd(8)}${status.padEnd(19)}${restarts.padEnd(11)}${age}`;
const PODS = [
  pod("NAME", "READY", "STATUS", "RESTARTS", "AGE"),
  ...Array.from({ length: 17 }, (_, i) =>
    pod(`api-7f9c65d4b8-${i}xkp`, "1/1", "Running", "0", "3d2h"),
  ),
  pod("queue-5f6d7c8b9d-a1b2c", "1/1", "Running", "6 (12m ago)", "3d2h"),
  pod("worker-6b7d9c5f4d-9qwzr", "0/1", "CrashLoopBackOff", "12", "3d2h"),
  pod("ingest-5d8f7b6c9d-tk2lm", "0/1", "Pending", "0", "14m"),
].join("\n");

describe("kubectl-get filter", () => {
  it("keeps every anomaly and restarted pod, folds healthy rows", () => {
    const out = assertFilterConformance(filter, PODS);
    expect(out).toContain("CrashLoopBackOff");
    expect(out).toContain("Pending");
    expect(out).toContain("6 (12m ago)"); // restarted-but-Running is evidence
    expect(out).toContain("api-7f9c65d4b8-4xkp");
    expect(out).not.toContain("api-7f9c65d4b8-9xkp");
    expect(out).toContain("… [12 more Running]");
  });

  it("passes tables without a STATUS column through verbatim", () => {
    const svc =
      "NAME         TYPE        CLUSTER-IP     PORT(S)   AGE\napi   ClusterIP   10.0.0.12   80/TCP    3d";
    expect(compressKubectlGet(svc)).toBe(svc);
  });
});
