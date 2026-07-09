import { describe, expect, it, vi } from "vitest";
import { runOutputGc } from "../../src/commands/output/gc.js";

const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);

function run(over: { days?: string; json?: boolean; removed?: number } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const prune = vi.fn(async () => ({ removed: over.removed ?? 2 }));
  const code = runOutputGc({
    storeRoot: "/store",
    now: () => NOW,
    ...(over.days === undefined ? {} : { days: over.days }),
    json: over.json ?? false,
    prune,
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
  });
  return { code, out, err, prune };
}

describe("runOutputGc", () => {
  it("defaults to 30 days and reports the removed count", async () => {
    const { code, out, prune } = run();
    expect(await code).toBe(0);
    expect(prune).toHaveBeenCalledWith({
      storeRoot: "/store",
      olderThan: new Date(NOW - 30 * 86_400_000),
    });
    expect(out.join("\n")).toContain("removed 2 chunk set(s)");
  });

  it("honors --days override", async () => {
    const { code, prune } = run({ days: "7" });
    expect(await code).toBe(0);
    expect(prune).toHaveBeenCalledWith({
      storeRoot: "/store",
      olderThan: new Date(NOW - 7 * 86_400_000),
    });
  });

  it("--json emits the stable shape", async () => {
    const { code, out } = run({ json: true, removed: 5 });
    expect(await code).toBe(0);
    expect(JSON.parse(out[0] as string)).toEqual({ removed: 5 });
  });

  it("rejects bad --days with exit 1 and does not prune", async () => {
    for (const days of ["0", "-1", "abc", "3651", "1.5"]) {
      const { code, err, prune } = run({ days });
      expect(await code).toBe(1);
      expect(err.join("\n")).toContain("Invalid --days");
      expect(prune).not.toHaveBeenCalled();
    }
  });

  it("surfaces a prune failure as exit 1", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = runOutputGc({
      storeRoot: "/store",
      now: () => NOW,
      json: false,
      prune: vi.fn(async () => {
        throw new Error("disk gone");
      }),
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
    });
    expect(await code).toBe(1);
    expect(err.join("\n")).toContain("error:");
  });
});
