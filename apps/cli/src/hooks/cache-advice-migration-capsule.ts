import { join } from "node:path";
import { cacheAdviceRecordDirectory } from "./cache-advice-queue.js";
import {
  prepareOwnerOnlyStoreChild,
  resolveTaskKickoffStoreDependencies,
} from "./task-kickoff-store-fs.js";

// Create the owner-private v3 capsule directory for a record, returning its
// path only when it matches the canonical record directory exactly.
export async function prepareCapsuleDirectory(
  storeRoot: string,
  recordId: string,
  platform: NodeJS.Platform,
): Promise<string | undefined> {
  const dependencies = resolveTaskKickoffStoreDependencies();
  const recordsRoot = join(storeRoot, "stats", "cache-advice-v3", "records");
  const shardOne = await prepareOwnerOnlyStoreChild(
    recordsRoot,
    recordId.slice(0, 2),
    platform,
    dependencies,
  );
  const shardTwo = await prepareOwnerOnlyStoreChild(
    shardOne,
    recordId.slice(2, 4),
    platform,
    dependencies,
  );
  const capsule = await prepareOwnerOnlyStoreChild(shardTwo, recordId, platform, dependencies);
  return capsule === cacheAdviceRecordDirectory(storeRoot, recordId) ? capsule : undefined;
}
