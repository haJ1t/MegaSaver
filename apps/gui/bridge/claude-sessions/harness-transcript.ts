import { readCodexTranscript, resolveCodexTranscriptPath } from "./codex-transcript.js";
import { readOpenCodeTranscript } from "./opencode-transcript.js";
import { readPiTranscript, resolvePiTranscriptPath } from "./pi-transcript.js";
import type { ClaudeTranscript } from "./types.js";

export async function resolveHarnessTranscriptPath(
  homeDir: string,
  id: string,
): Promise<{ path: string; offset: number; kind: "jsonl" | "sqlite"; dbPath?: string } | null> {
  const codex = await resolveCodexTranscriptPath(homeDir, id);
  if (codex) return { ...codex, kind: "jsonl" };
  const pi = await resolvePiTranscriptPath(homeDir, id);
  if (pi) return { ...pi, kind: "jsonl" };
  return null;
}

export async function readHarnessTranscript(
  homeDir: string,
  id: string,
): Promise<ClaudeTranscript | null> {
  const codex = await readCodexTranscript(homeDir, id);
  if (codex) return codex;
  const pi = await readPiTranscript(homeDir, id);
  if (pi) return pi;
  const oc = await readOpenCodeTranscript(homeDir, id);
  if (oc) return oc;
  return null;
}

export { readCodexTranscript, readPiTranscript, readOpenCodeTranscript };
export type { ClaudeTranscript };
