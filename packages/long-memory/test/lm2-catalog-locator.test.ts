import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Lm1Record } from "../src/lm1-model.js";
import { createFileLm1Store } from "../src/lm1-store.js";
import {
  catalogEntry,
  cleanupRoots,
  createRecord,
  createRoot,
  workspaceKey,
} from "./lm2-catalog-fixtures.js";

afterEach(cleanupRoots);

describe("LM2 candidate catalog LM1 locators", () => {
  it("reads exact LM1 locators with expected tuples and never needs record enumeration", () => {
    const root = createRoot();
    const store = createFileLm1Store({ storeRoot: root }) as ReturnType<
      typeof createFileLm1Store
    > & {
      getByIds(
        requestedWorkspaceKey: string,
        entries: readonly Pick<Lm1Record, "id" | "kind" | "sourceDigest">[],
        limit: number,
      ): readonly Lm1Record[];
    };
    const record = createRecord();
    const second = createRecord(1);
    const otherWorkspaceRecord = createRecord(2, "fedcba9876543210");
    store.publish(record);
    store.publish(second);
    store.publish(otherWorkspaceRecord);
    const snapshots = join(root, "long-memory", "v1", workspaceKey, "snapshots");
    writeFileSync(join(snapshots, `${"c".repeat(64)}.json`), "{corrupt");

    expect(store.getByIds(workspaceKey, [catalogEntry(record, 1)], 1)).toEqual([record]);
    expect(
      store.getByIds(workspaceKey, [catalogEntry(record, 1), catalogEntry(second, 2)], 1),
    ).toEqual([record]);
    expect(() =>
      store.getByIds(
        workspaceKey,
        [{ ...catalogEntry(record, 1), sourceDigest: "d".repeat(64) }],
        1,
      ),
    ).toThrow(expect.objectContaining({ code: "store_corrupt" }));
    expect(() => store.getByIds("fedcba9876543210", [catalogEntry(record, 1)], 1)).toThrow(
      expect.objectContaining({ code: "store_corrupt" }),
    );
    expect(() =>
      store.getByIds(workspaceKey, [{ ...catalogEntry(record, 1), id: second.id }], 1),
    ).toThrow(expect.objectContaining({ code: "store_corrupt" }));
    expect(() =>
      store.getByIds(workspaceKey, [{ ...catalogEntry(record, 1), kind: "state_transition" }], 1),
    ).toThrow(expect.objectContaining({ code: "store_corrupt" }));
    expect(() => store.getByIds(workspaceKey, [catalogEntry(record, 1)], 10_001)).toThrow(
      expect.objectContaining({ code: "invalid_input" }),
    );
  });
});
