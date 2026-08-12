import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { redact } from "@megasaver/policy";
import { z } from "zod";
import { postEvent } from "./events.js";
import { meshPaths } from "./paths.js";
import { listPeers } from "./presence.js";
import { ASK_MIN_INTERVAL_MS, type AskPayload, askPayloadSchema } from "./qa.js";
import { atomicWriteFileSync, quarantineFileSync, safeJsonParse } from "./store.js";
import { type MeshEvent, meshEventSchema } from "./types.js";

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function isSafeSegment(v: string): boolean {
  return SAFE_SEGMENT.test(v);
}

export function askStateFilePath(storeRoot: string, senderId: string): string {
  return join(storeRoot, "mesh", "ask-state", `${senderId}.json`);
}

const askStateSchema = z.object({ lastAskAtMs: z.number().int().nonnegative() }).strict();

export type AskRateVerdict = { limited: false } | { limited: true; retryAtMs: number };

export function checkAskRateLimit(
  storeRoot: string,
  senderId: string,
  now: () => number = () => Date.now(),
): AskRateVerdict {
  if (!isSafeSegment(senderId)) return { limited: false };
  const filePath = askStateFilePath(storeRoot, senderId);
  if (!existsSync(filePath)) return { limited: false };
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return { limited: false };
  }
  if (raw.trim() === "") {
    quarantineFileSync(filePath, storeRoot);
    return { limited: false };
  }
  const parsed = safeJsonParse(raw);
  if (parsed === undefined) {
    quarantineFileSync(filePath, storeRoot);
    return { limited: false };
  }
  const result = askStateSchema.safeParse(parsed);
  if (!result.success) {
    quarantineFileSync(filePath, storeRoot);
    return { limited: false };
  }
  const last = result.data.lastAskAtMs;
  const nowMs = now();
  if (nowMs - last < ASK_MIN_INTERVAL_MS) {
    return { limited: true, retryAtMs: last + ASK_MIN_INTERVAL_MS };
  }
  return { limited: false };
}

export function recordAskPosted(storeRoot: string, senderId: string, atMs: number): void {
  if (!isSafeSegment(senderId)) return;
  const filePath = askStateFilePath(storeRoot, senderId);
  const dir = dirname(filePath);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {}
  try {
    atomicWriteFileSync(filePath, `${JSON.stringify({ lastAskAtMs: atMs })}\n`);
  } catch {}
}

// -- postAsk --------------------------------------------------------------

export type PostAskDeps = {
  listLivePeers: (
    storeRoot: string,
    workspaceKey: string,
  ) => Promise<ReadonlyArray<{ liveSessionId: string }>> | ReadonlyArray<{ liveSessionId: string }>;
  deliverAsk: (input: {
    storeRoot: string;
    to: string;
    from: string;
    payload: AskPayload;
  }) => Promise<void> | void;
  redactText: (text: string) => string;
};

export type PostAskResult =
  | { posted: true; askId: string; recipients: number }
  | { posted: false; reason: "no_live_peers" | "rate_limited" | "mesh_unavailable" };

function defaultRedact(text: string): string {
  return redact(text).redacted;
}

async function defaultListLivePeers(
  storeRoot: string,
  workspaceKey: string,
): Promise<ReadonlyArray<{ liveSessionId: string }>> {
  const peers = listPeers(storeRoot, { workspaceKey });
  return peers.map((p) => ({ liveSessionId: p.liveSessionId }));
}

async function defaultDeliverAsk(input: {
  storeRoot: string;
  to: string;
  from: string;
  payload: AskPayload;
}): Promise<void> {
  const text = JSON.stringify(input.payload);
  const bounded = text.length > 4000 ? text.slice(0, 4000) : text;
  const evt: MeshEvent = {
    id: input.payload.askId,
    kind: "ask",
    from: input.from,
    text: bounded,
    createdAt: new Date(input.payload.askedAtMs).toISOString(),
    to: input.to,
  };
  const parsed = meshEventSchema.parse(evt);
  postEvent(input.storeRoot, parsed);
  // inbox fanout: write directly to recipient inbox
  const { inboxDir } = meshPaths(input.storeRoot);
  const dir = join(inboxDir, input.to);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {}
  const filePath = join(dir, `${parsed.id}.json`);
  try {
    atomicWriteFileSync(filePath, `${JSON.stringify(parsed)}\n`);
  } catch {}
  // also ensure bus event is counted? postEvent already did. Ensure inbox base exists.
  try {
    mkdirSync(inboxDir, { recursive: true, mode: 0o700 });
  } catch {}
}

// Overloaded postAsk: supports both brief (storeRoot, {from,text,workspaceKey}) and detailed ({storeRoot,from,workspaceKey,question,...}, deps)
export async function postAsk(
  storeRootOrInput:
    | string
    | {
        storeRoot: string;
        from: string;
        workspaceKey: string;
        question?: string;
        text?: string;
        to?: string;
        now?: () => number;
        newId?: () => string;
      },
  inputOrDeps?:
    | {
        from: string;
        text?: string;
        question?: string;
        workspaceKey: string;
        to?: string;
        now?: () => number;
        newId?: () => string;
      }
    | Partial<PostAskDeps>,
  maybeDeps?: Partial<PostAskDeps>,
): Promise<PostAskResult> {
  let storeRoot: string;
  let from: string;
  let workspaceKey: string;
  let question: string;
  let to: string | undefined;
  let now: () => number;
  let newId: () => string;
  let deps: Partial<PostAskDeps> | undefined;

  if (typeof storeRootOrInput === "string") {
    const input = inputOrDeps as {
      from: string;
      text?: string;
      question?: string;
      workspaceKey: string;
      to?: string;
      now?: () => number;
      newId?: () => string;
    };
    storeRoot = storeRootOrInput;
    from = input.from;
    workspaceKey = input.workspaceKey;
    question = (input.question ?? input.text ?? "") as string;
    to = input.to;
    now = input.now ?? (() => Date.now());
    newId = input.newId ?? (() => randomUUID());
    deps = maybeDeps;
  } else {
    const inp = storeRootOrInput as {
      storeRoot: string;
      from: string;
      workspaceKey: string;
      question?: string;
      text?: string;
      to?: string;
      now?: () => number;
      newId?: () => string;
    };
    storeRoot = inp.storeRoot;
    from = inp.from;
    workspaceKey = inp.workspaceKey;
    question = (inp.question ?? inp.text ?? "") as string;
    to = inp.to;
    now = inp.now ?? (() => Date.now());
    newId = inp.newId ?? (() => randomUUID());
    deps = inputOrDeps as Partial<PostAskDeps> | undefined;
  }

  const redactText = deps?.redactText ?? defaultRedact;
  const listLivePeers = deps?.listLivePeers ?? defaultListLivePeers;
  const deliverAsk = deps?.deliverAsk ?? defaultDeliverAsk;

  try {
    const rate = checkAskRateLimit(storeRoot, from, now);
    if (rate.limited) {
      return { posted: false, reason: "rate_limited" };
    }

    const peers = await listLivePeers(storeRoot, workspaceKey);
    const liveIds = peers.map((p) => p.liveSessionId).filter((id) => id !== from);

    if (to !== undefined) {
      if (!liveIds.includes(to)) {
        return { posted: false, reason: "no_live_peers" };
      }
      const redacted = redactText(question);
      const askId = newId();
      const askedAtMs = now();
      const payload: AskPayload = {
        askId,
        question: redacted,
        workspaceKey,
        askedAtMs,
      };
      const parsed = askPayloadSchema.parse(payload);
      await deliverAsk({ storeRoot, to, from, payload: parsed });
      recordAskPosted(storeRoot, from, askedAtMs);
      return { posted: true, askId, recipients: 1 };
    }

    if (liveIds.length === 0) {
      return { posted: false, reason: "no_live_peers" };
    }

    const redacted = redactText(question);
    const askId = newId();
    const askedAtMs = now();
    const payload: AskPayload = {
      askId,
      question: redacted,
      workspaceKey,
      askedAtMs,
    };
    const parsed = askPayloadSchema.parse(payload);
    for (const recipient of liveIds) {
      if (!isSafeSegment(recipient)) continue;
      if (recipient.includes("/") || recipient.includes("\\") || recipient.includes("\0")) continue;
      await deliverAsk({ storeRoot, to: recipient, from, payload: parsed });
    }
    recordAskPosted(storeRoot, from, askedAtMs);
    return { posted: true, askId, recipients: liveIds.length };
  } catch {
    return { posted: false, reason: "mesh_unavailable" };
  }
}
