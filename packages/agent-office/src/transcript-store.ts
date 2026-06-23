import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile } from "./atomic-write.js";
import { AgentOfficeError } from "./errors.js";
import { transcriptDir, transcriptPath } from "./paths.js";
import { type TranscriptEntry, transcriptEntrySchema } from "./transcript.js";

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function parseTranscriptFile(path: string, raw: string): TranscriptEntry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new AgentOfficeError("store_corrupt", `Corrupt transcript file: ${path}`, { cause });
  }
  try {
    return transcriptEntrySchema.parse(parsed);
  } catch (cause) {
    throw new AgentOfficeError("store_corrupt", `Corrupt transcript file: ${path}`, { cause });
  }
}

export async function appendTranscript(input: {
  storeRoot: string;
  workspaceKey: string;
  officeAgentId: string;
  entry: TranscriptEntry;
}): Promise<void> {
  let entry: TranscriptEntry;
  try {
    entry = transcriptEntrySchema.parse(input.entry);
  } catch (cause) {
    throw new AgentOfficeError("schema_invalid", "Transcript entry is invalid.", { cause });
  }
  const path = transcriptPath({
    storeRoot: input.storeRoot,
    workspaceKey: input.workspaceKey,
    officeAgentId: input.officeAgentId,
    transcriptId: entry.id,
  });
  atomicWriteFile(path, `${JSON.stringify(entry, null, 2)}\n`);
}

export async function listTranscript(input: {
  storeRoot: string;
  workspaceKey: string;
  officeAgentId: string;
}): Promise<readonly TranscriptEntry[]> {
  const dir = transcriptDir(input.storeRoot, input.workspaceKey, input.officeAgentId);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return [];
    throw error;
  }
  const entries: TranscriptEntry[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    entries.push(parseTranscriptFile(path, readFileSync(path, "utf8")));
  }
  entries.sort((a, b) => a.ts.localeCompare(b.ts) || a.seq - b.seq);
  return entries;
}
