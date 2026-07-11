import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BrainSyncError } from "../src/errors.js";
import { type SyncDeps, pull, push, status } from "../src/sync.js";
import { type Transport, createTransport } from "../src/transport.js";
import { type S3Double, startS3Double } from "./helpers/s3-double.js";

let double: S3Double;
let transport: Transport;
const key = randomBytes(32);
const projectId = "3b6c1c8e-0f4c-4d6a-9b3e-2f8a1c9d7e5f";

// Fake "local machine": in-memory bundle + last-seen
function makeMachine(initialBundle: string) {
  let bundle = initialBundle;
  let lastSeen = 0;
  const imported: string[] = [];
  const deps: SyncDeps = {
    transport,
    key,
    projectId,
    lastSeenGeneration: () => lastSeen,
    persistLastSeen: (generation) => {
      lastSeen = generation;
    },
    exportBundle: () => bundle,
    importBundle: (text) => {
      imported.push(text);
      // simulate a MERGE (union), not replacement — after merging, the local
      // export must differ from the remote when local had its own content,
      // otherwise push's skip-unchanged check would short-circuit the CAS
      // retry tests below.
      bundle = bundle === text ? text : [...new Set([bundle, text])].sort().join("|");
    },
    now: () => new Date("2026-07-11T12:00:00.000Z"),
  };
  return {
    deps,
    imported,
    setBundle: (b: string) => {
      bundle = b;
    },
    getLastSeen: () => lastSeen,
  };
}

beforeEach(async () => {
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  process.env["MEGA_SYNC_ACCESS_KEY_ID"] = "test";
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  process.env["MEGA_SYNC_SECRET_ACCESS_KEY"] = "test";
  double = await startS3Double();
  transport = await createTransport({
    endpoint: double.url,
    region: "auto",
    bucket: "b",
    prefix: "proj-1/",
    pathStyle: true,
  });
});
afterEach(async () => {
  await double.close();
});

describe("pull/status", () => {
  it("pull on empty remote → empty", async () => {
    const m = makeMachine("bundle-a");
    expect(await pull(m.deps)).toEqual({ state: "empty" });
    expect(await status(m.deps)).toEqual({ state: "empty" });
  });

  it("pull merges a newer remote and persists last-seen", async () => {
    const a = makeMachine("bundle-a");
    await push(a.deps); // publishes generation 1
    const b = makeMachine("bundle-b");
    const result = await pull(b.deps);
    expect(result).toEqual({ state: "merged", generation: 1 });
    expect(b.imported).toEqual(["bundle-a"]);
    expect(b.getLastSeen()).toBe(1);
    expect(await pull(b.deps)).toEqual({ state: "up-to-date", generation: 1 });
  });

  it("pull with wrong key → wrong_key, remote untouched", async () => {
    const a = makeMachine("bundle-a");
    await push(a.deps);
    const evil = makeMachine("x");
    (evil.deps as { key: Uint8Array }).key = randomBytes(32);
    try {
      await pull(evil.deps);
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("wrong_key");
    }
  });

  it("rollback (remote older than last-seen) → rollback_detected", async () => {
    const a = makeMachine("bundle-a");
    await push(a.deps); // gen 1
    a.setBundle("bundle-a2");
    await push(a.deps); // gen 2
    // adversary re-serves the gen-1 manifest: snapshot then restore store
    const snapshot = new Map(double.store);
    a.setBundle("bundle-a3");
    await push(a.deps); // gen 3, lastSeen 3
    double.store.clear();
    for (const [k, v] of snapshot) double.store.set(k, v);
    try {
      await pull(a.deps);
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("rollback_detected");
    }
  });

  it("hash mismatch between manifest and object → hash_mismatch", async () => {
    const a = makeMachine("bundle-a");
    await push(a.deps);
    // corrupt: swap object body for a validly-encrypted DIFFERENT text under the same key+AAD
    const manifestEntry = double.store.get("proj-1/manifest.json.enc");
    expect(manifestEntry).toBeDefined();
    const { openManifest, objectAad } = await import("../src/manifest.js");
    const { encrypt } = await import("../src/crypto.js");
    const manifest = openManifest(manifestEntry?.body ?? new Uint8Array(), key, projectId);
    const forged = encrypt(
      Buffer.from("not-the-bundle"),
      key,
      objectAad(projectId, manifest.objectKey),
    );
    double.store.set(`proj-1/${manifest.objectKey}`, { body: Buffer.from(forged), etag: '"f"' });
    const b = makeMachine("x");
    try {
      await pull(b.deps);
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("hash_mismatch");
    }
  });

  it("status reports generations without mutating", async () => {
    const a = makeMachine("bundle-a");
    await push(a.deps);
    const b = makeMachine("bundle-b");
    const s = await status(b.deps);
    expect(s).toEqual({
      state: "ok",
      remoteGeneration: 1,
      lastSeenGeneration: 0,
      upToDate: false,
      updatedAt: "2026-07-11T12:00:00.000Z",
    });
    expect(b.imported).toEqual([]);
  });
});

describe("push", () => {
  it("bootstrap push creates generation 1 (If-None-Match)", async () => {
    const a = makeMachine("bundle-a");
    expect(await push(a.deps)).toEqual({ state: "pushed", generation: 1, merged: false });
    expect(a.getLastSeen()).toBe(1);
    expect(double.store.has("proj-1/manifest.json.enc")).toBe(true);
  });

  it("skip-unchanged: same bundle hash → up-to-date, no generation churn", async () => {
    const a = makeMachine("bundle-a");
    await push(a.deps);
    expect(await push(a.deps)).toEqual({ state: "up-to-date", generation: 1 });
  });

  it("push merges unseen remote changes first (merged: true)", async () => {
    const a = makeMachine("bundle-a");
    await push(a.deps);
    const b = makeMachine("bundle-b");
    const result = await push(b.deps);
    expect(result).toEqual({ state: "pushed", generation: 2, merged: true });
    expect(b.imported).toEqual(["bundle-a"]); // merged before publishing
  });

  it("deletes the previously referenced object after success (single live object)", async () => {
    const a = makeMachine("bundle-a");
    await push(a.deps);
    a.setBundle("bundle-a2");
    await push(a.deps);
    const objectKeys = [...double.store.keys()].filter((k) => k.startsWith("proj-1/objects/"));
    expect(objectKeys).toHaveLength(1);
  });

  it("CAS race: manifest changes between read and write → retry succeeds", async () => {
    const a = makeMachine("bundle-a");
    await push(a.deps);
    const b = makeMachine("bundle-b");
    let raced = false;
    const rawPut = transport.putObject.bind(transport);
    (b.deps as { transport: Transport }).transport = {
      ...transport,
      putObject: async (putKey, body, condition) => {
        if (!raced && putKey === "manifest.json.enc") {
          raced = true;
          a.setBundle("bundle-a2");
          await push(a.deps); // bumps remote to gen 2 with A's etag
        }
        return rawPut(putKey, body, condition);
      },
    };
    const result = await push(b.deps);
    expect(result.state).toBe("pushed");
    expect(result.generation).toBe(3); // 1 (a) → 2 (a race) → 3 (b retry)
    expect(b.imported).toContain("bundle-a2"); // retry re-merged the racing change
  });

  it("gives up after 3 CAS attempts → sync_conflict", async () => {
    const a = makeMachine("bundle-a");
    await push(a.deps);
    const b = makeMachine("bundle-b");
    let generationFeeder = 1;
    const rawPut = transport.putObject.bind(transport);
    (b.deps as { transport: Transport }).transport = {
      ...transport,
      putObject: async (putKey, body, condition) => {
        if (putKey === "manifest.json.enc") {
          generationFeeder += 1;
          a.setBundle(`bundle-a${generationFeeder}`);
          await push(a.deps); // always wins the race
        }
        return rawPut(putKey, body, condition);
      },
    };
    try {
      await push(b.deps);
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("sync_conflict");
    }
  });
});
