import { isAbsolute, resolve } from "node:path";
import { answerPayloadSchema, readEvents, sendMessage } from "@megasaver/mesh";
import { redact } from "@megasaver/policy";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { defineCommand } from "citty";
import { z } from "zod";
import { mapErrorToCliMessage, meshUnavailableMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";

export type AnswerEvidence =
  | { kind: "chunk-set"; chunkSetId: string }
  | { kind: "file-line"; file: string; line: number }
  | { kind: "none" };

function isRepoRelative(p: string): boolean {
  const t = p.trim();
  if (t.length === 0) return false;
  if (t.startsWith("/")) return false;
  if (/^[A-Za-z]:[\\/]/.test(t)) return false;
  return true;
}

export function parseEvidenceFlag(raw: string | undefined): AnswerEvidence | { error: string } {
  if (raw === undefined || raw.trim() === "") return { kind: "none" };
  const trimmed = raw.trim();
  if (trimmed.startsWith("chunkset:")) {
    const id = trimmed.slice("chunkset:".length).trim();
    if (id.length === 0) return { error: "chunkset id must be non-empty" };
    return { kind: "chunk-set", chunkSetId: id };
  }
  // file:line — last colon split
  const lastColon = trimmed.lastIndexOf(":");
  if (lastColon === -1) return { error: `invalid evidence ref: ${raw}` };
  const file = trimmed.slice(0, lastColon).trim();
  const lineStr = trimmed.slice(lastColon + 1).trim();
  if (file.length === 0 || lineStr.length === 0) return { error: `invalid evidence ref: ${raw}` };
  if (!isRepoRelative(file)) return { error: `evidence file must be repo-relative: ${file}` };
  const line = Number(lineStr);
  if (!Number.isInteger(line) || line <= 0)
    return { error: `evidence line must be positive int: ${lineStr}` };
  return { kind: "file-line", file, line };
}

export type RunMeshAnswerInput = {
  askId: string;
  text?: string;
  unknown?: boolean;
  confidence?: "high" | "medium" | "low";
  evidence?: string;
  session?: string;
  storeFlag: string | undefined;
  cwd: string;
  home?: string;
  xdgDataHome?: string | undefined;
  platform?: NodeJS.Platform;
  localAppData?: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  now?: () => number;
};

function resolveStoreRoot(input: RunMeshAnswerInput): string {
  if (input.storeFlag !== undefined) {
    const trimmed = input.storeFlag.trim();
    if (trimmed.length === 0) throw new Error("store path must be non-empty");
    return isAbsolute(trimmed) ? trimmed : resolve(input.cwd, trimmed);
  }
  if (input.home !== undefined) {
    return resolveStorePath({
      storeFlag: undefined,
      cwd: input.cwd,
      home: input.home,
      xdgDataHome: input.xdgDataHome,
      platform: input.platform ?? process.platform,
      localAppData: input.localAppData,
    });
  }
  return resolveStorePath(readStoreEnv(undefined));
}

export async function runMeshAnswer(input: RunMeshAnswerInput): Promise<0 | 1> {
  if (typeof input.askId !== "string" || input.askId.trim() === "") {
    input.stderr("error: --askId is required");
    return 1;
  }
  const askId = input.askId.trim();

  const evidenceResult = parseEvidenceFlag(input.evidence);
  if ("error" in evidenceResult) {
    input.stderr(`error: ${evidenceResult.error}`);
    return 1;
  }

  let storeRoot: string;
  try {
    storeRoot = resolveStoreRoot(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    await ensureStoreReady(storeRoot);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const cli = meshUnavailableMessage(detail);
    input.stderr(cli.message);
    return cli.exitCode;
  }

  // Resolve ask by askId from recent bus events (last 200)
  let targetFrom: string | undefined;
  try {
    const events = readEvents(storeRoot, {});
    const sliced = events.length > 200 ? events.slice(-200) : events;
    for (const evt of sliced) {
      if (evt.kind !== "ask") continue;
      let payload: unknown;
      try {
        payload = JSON.parse(evt.text);
      } catch {
        // fallback: ask text may be plain? treat evt.id as askId
        if (evt.id === askId) {
          targetFrom = evt.from;
          break;
        }
        continue;
      }
      const obj = payload as Record<string, unknown>;
      // biome-ignore lint/complexity/useLiteralKeys: index signature requires bracket
      if (typeof obj["askId"] === "string" && obj["askId"] === askId) {
        targetFrom = evt.from;
        break;
      }
      if (evt.id === askId) {
        targetFrom = evt.from;
        break;
      }
    }
  } catch {}

  if (targetFrom === undefined) {
    input.stderr(`error: ask not found: ${askId}`);
    return 1;
  }

  const isUnknown = input.unknown === true;
  const rawText = input.text ?? "";
  const confidence = input.confidence ?? "high";
  if (!["high", "medium", "low"].includes(confidence)) {
    input.stderr(`error: invalid confidence: ${confidence}`);
    return 1;
  }

  // known:true requires non-empty text (handled by schema superRefine, but early check for clearer message)
  const workspaceKey = encodeWorkspaceKey(input.cwd);
  const liveSessionId = input.session ?? `cli-${workspaceKey}`;
  const atMs = input.now ? input.now() : Date.now();

  let textForPayload = rawText;
  if (!isUnknown) {
    if (textForPayload.trim() === "") {
      input.stderr("error: --text is required for known answer");
      return 1;
    }
    // redact before persist per spec
    textForPayload = redact(textForPayload).redacted;
  } else {
    textForPayload = "";
  }

  const payload = {
    askId,
    known: !isUnknown,
    text: textForPayload,
    confidence: confidence as "high" | "medium" | "low",
    provenance: {
      liveSessionId,
      evidence: evidenceResult,
      answeredAtMs: atMs,
    },
  };

  const parsed = answerPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    input.stderr(`error: ${parsed.error.message}`);
    return 1;
  }

  const serialized = JSON.stringify(parsed.data);
  if (serialized.length > 4000) {
    input.stderr("error: answer payload exceeds 4000 chars");
    return 1;
  }

  try {
    sendMessage(storeRoot, {
      from: liveSessionId,
      to: targetFrom,
      kind: "answer",
      text: serialized,
    });
    input.stdout(`answer to ${askId} delivered to ${targetFrom}`);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const meshAnswerCommand = defineCommand({
  meta: {
    name: "answer",
    description: "Answer a peer ask with provenance (file:line or chunkset:).",
  },
  args: {
    askId: { type: "positional", required: true, description: "Ask ID to answer." },
    text: { type: "string", description: "Answer text (required unless --unknown)." },
    unknown: {
      type: "boolean",
      default: false,
      description: "Send 'I don't know' (known:false, empty text allowed).",
    },
    confidence: { type: "string", default: "high", description: "Confidence: high|medium|low." },
    evidence: {
      type: "string",
      description: "Evidence: <path>:<line> or chunkset:<id> (default none).",
    },
    session: {
      type: "string",
      description: "Override sender liveSessionId (default cli-<workspaceKey>).",
    },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeFlag = typeof args.store === "string" ? (args.store as string) : undefined;
    const askId = typeof args.askId === "string" ? args.askId : "";
    const text =
      typeof (args as { text?: unknown }).text === "string"
        ? ((args as { text: string }).text as string)
        : undefined;
    const unknown = Boolean((args as { unknown?: unknown }).unknown);
    const confidenceRaw =
      typeof (args as { confidence?: unknown }).confidence === "string"
        ? ((args as { confidence: string }).confidence as string)
        : "high";
    const confidence = (
      confidenceRaw === "high" || confidenceRaw === "medium" || confidenceRaw === "low"
        ? confidenceRaw
        : "high"
    ) as "high" | "medium" | "low";
    const evidence =
      typeof (args as { evidence?: unknown }).evidence === "string"
        ? ((args as { evidence: string }).evidence as string)
        : undefined;
    const session =
      typeof (args as { session?: unknown }).session === "string"
        ? ((args as { session: string }).session as string)
        : undefined;
    const env = readStoreEnv(storeFlag);
    const code = await runMeshAnswer({
      askId,
      ...(text !== undefined ? { text } : {}),
      unknown,
      confidence,
      ...(evidence !== undefined ? { evidence } : {}),
      ...(session !== undefined ? { session } : {}),
      storeFlag: env.storeFlag,
      cwd: env.cwd,
      home: env.home,
      xdgDataHome: env.xdgDataHome,
      platform: env.platform,
      localAppData: env.localAppData,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
