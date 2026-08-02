import { join } from "node:path";
import { z } from "zod";
import {
  effectivePosixUserId,
  readBoundedPrivateFile,
  replacePrivateFile,
} from "./cache-advice-private-node.js";

const MIGRATION_JOURNAL = "migration.json";
const MIGRATION_JOURNAL_BYTES = 4_096;

const migrationJournalSchema = z
  .object({
    version: z.literal(1),
    complete: z.boolean(),
    completedAt: z.number().finite().nullable(),
  })
  .strict();

function journalPath(storeRoot: string): string {
  return join(storeRoot, "stats", "cache-advice-v3", MIGRATION_JOURNAL);
}

export async function readMigrationJournal(
  storeRoot: string,
): Promise<z.infer<typeof migrationJournalSchema> | undefined> {
  try {
    const uid = effectivePosixUserId();
    const entry = await readBoundedPrivateFile(
      journalPath(storeRoot),
      MIGRATION_JOURNAL_BYTES,
      uid,
    );
    if (entry === undefined) return undefined;
    return migrationJournalSchema.parse(JSON.parse(entry.raw));
  } catch {
    return undefined;
  }
}

export async function writeMigrationJournal(
  storeRoot: string,
  complete: boolean,
  completedAt: number | null,
): Promise<void> {
  const uid = effectivePosixUserId();
  const journal = `${JSON.stringify({ version: 1, complete, completedAt })}\n`;
  if (Buffer.byteLength(journal, "utf8") > MIGRATION_JOURNAL_BYTES) {
    throw new Error("cache advice migration journal exceeds its byte ceiling");
  }
  await replacePrivateFile(
    join(storeRoot, "stats", "cache-advice-v3"),
    journalPath(storeRoot),
    journal,
    uid,
  );
}

export async function cacheAdviceMigrationComplete(storeRoot: string): Promise<boolean> {
  if (process.platform === "win32") return true;
  const journal = await readMigrationJournal(storeRoot);
  return journal?.complete === true;
}
