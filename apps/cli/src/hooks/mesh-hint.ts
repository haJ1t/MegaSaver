import { readSync } from "node:fs";
import { readEvents } from "@megasaver/mesh";
import {
  HINT_EVENT_WINDOW_MS,
  HINT_MAX_CHARS,
  HINT_MAX_EVENTS,
  type PeerAnswerCandidate,
  extractKeywords as meshExtractKeywords,
  matchPeerAnswer as meshMatchPeerAnswer,
  renderPeerAnswerHint,
} from "@megasaver/mesh";
import { z } from "zod";
import { readStoreEnv, resolveStorePath } from "../store.js";

export { HINT_EVENT_WINDOW_MS, HINT_MAX_EVENTS, HINT_MAX_CHARS, renderPeerAnswerHint };
export { meshExtractKeywords as extractKeywords, meshMatchPeerAnswer as matchPeerAnswer };

export const HINT_MIN_SHARED_KEYWORDS = 3;

const payloadSchema = z
  .object({
    prompt: z.string(),
    cwd: z.string().min(1),
    session_id: z.string().min(1).optional(),
  })
  .passthrough();

export const MAX_MESH_HINT_STDIN_BYTES = 256 * 1024;

export function readStdinSync(): string | undefined {
  try {
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= MAX_MESH_HINT_STDIN_BYTES) {
      const capacity = Math.min(8192, MAX_MESH_HINT_STDIN_BYTES - total + 1);
      const chunk = Buffer.allocUnsafe(capacity);
      const read = readSync(0, chunk, 0, capacity, null);
      if (read === 0) return Buffer.concat(chunks, total).toString("utf8");
      total += read;
      if (total > MAX_MESH_HINT_STDIN_BYTES) return undefined;
      chunks.push(chunk.subarray(0, read));
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export type MeshHintDeps = {
  loadCandidates: (
    storeRoot: string,
    excludeSessionId: string | undefined,
    now: () => number,
  ) => Promise<ReadonlyArray<PeerAnswerCandidate>>;
  write: (chunk: string) => void;
};

async function defaultLoadCandidates(
  storeRoot: string,
  excludeSessionId: string | undefined,
  now: () => number,
): Promise<ReadonlyArray<PeerAnswerCandidate>> {
  // Use workspaceKey derived from cwd? But loadCandidates is called with storeRoot and excludeSessionId; we need cwd to filter.
  // This default is not used directly in runMeshHintFromProcess's cwd-aware path; instead runMeshHint loads via readEvents.
  void storeRoot;
  void excludeSessionId;
  void now;
  return [];
}

export async function runMeshHintFromProcess(
  storeFlag?: string,
  deps?: Partial<MeshHintDeps>,
): Promise<void> {
  process.exitCode = 0;
  try {
    const input = readStdinSync();
    if (input === undefined) return;
    const raw = input.trim();
    if (raw === "") return;
    const payload: unknown = JSON.parse(raw);
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) return;
    const { prompt, cwd, session_id: sessionId } = parsed.data;
    if (prompt.trim() === "") return;

    const storeRoot = resolveStorePath(readStoreEnv(storeFlag));
    const now = () => Date.now();
    const loadCandidates = deps?.loadCandidates ?? defaultLoadCandidates;
    const write = deps?.write ?? ((chunk: string) => process.stdout.write(chunk));

    let candidates: ReadonlyArray<PeerAnswerCandidate>;
    if (deps?.loadCandidates !== undefined) {
      candidates = await loadCandidates(storeRoot, sessionId, now);
    } else {
      // default: read recent answer events via mesh, filter by workspaceKey if possible
      try {
        const events = readEvents(storeRoot, {});
        const sliced = events.length > HINT_MAX_EVENTS ? events.slice(-HINT_MAX_EVENTS) : events;
        const nowMs = now();
        const filtered: PeerAnswerCandidate[] = [];
        for (const evt of sliced) {
          if (evt.kind !== "answer") continue;
          if (sessionId !== undefined && evt.from === sessionId) continue;
          const evtMs = Date.parse(evt.createdAt);
          if (Number.isNaN(evtMs)) continue;
          if (nowMs - evtMs > HINT_EVENT_WINDOW_MS) continue;
          let payload: unknown;
          try {
            payload = JSON.parse(evt.text);
          } catch {
            continue;
          }
          const { answerPayloadSchema } = await import("@megasaver/mesh");
          const result = answerPayloadSchema.safeParse(payload);
          if (!result.success) continue;
          const ans = result.data;
          // Optionally filter by workspaceKey: require ask's workspaceKey equals prompt's workspaceKey?
          // For now, include all; future board-like sameScope could be added.
          filtered.push({
            askId: ans.askId,
            question: "",
            text: ans.text,
            answererLiveSessionId: ans.provenance.liveSessionId,
            evidenceLabel:
              ans.provenance.evidence.kind === "file-line"
                ? `${(ans.provenance.evidence as { file: string; line: number }).file}:${(ans.provenance.evidence as { file: string; line: number }).line}`
                : ans.provenance.evidence.kind === "chunk-set"
                  ? `chunk-set ${(ans.provenance.evidence as { chunkSetId: string }).chunkSetId}`
                  : "no evidence",
            atMs: ans.provenance.answeredAtMs,
          });
        }
        candidates = filtered;
      } catch {
        return;
      }
    }

    const match = meshMatchPeerAnswer(
      prompt,
      candidates as unknown as ReadonlyArray<PeerAnswerCandidate>,
      now(),
    );
    if (match === undefined) return;
    const candidate = match as unknown as PeerAnswerCandidate;
    const hint = renderPeerAnswerHint(candidate);
    const envelope = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: hint,
      },
    });
    write(envelope);
  } catch {
    // fail-open
  }
}
