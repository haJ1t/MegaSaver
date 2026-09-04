import { isAbsolute, resolve } from "node:path";
import { postFact } from "@megasaver/mesh";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { defineCommand } from "citty";
import { z } from "zod";
import { mapErrorToCliMessage, meshUnavailableMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";

const postInputSchema = z
  .object({
    text: z.string().trim().min(1),
    topic: z.string().trim().min(1),
    confidence: z.enum(["low", "medium", "high"]).optional().default("medium"),
    ttl: z.string().optional(),
    paths: z.array(z.string()).optional(),
  })
  .strict();

function resolveStoreRoot(input: {
  storeFlag: string | undefined;
  cwd: string;
  home?: string;
  xdgDataHome?: string | undefined;
  platform?: NodeJS.Platform;
  localAppData?: string | undefined;
}): string {
  if (input.storeFlag !== undefined) {
    const trimmed = input.storeFlag.trim();
    if (trimmed.length === 0) throw new Error("Store path must be non-empty.");
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

async function resolveRepoKey(
  cwd: string,
  platform: NodeJS.Platform | undefined,
  execGit?: (args: string[], cwd: string) => string,
): Promise<string> {
  if (execGit !== undefined) {
    try {
      const raw = execGit(["rev-parse", "--git-common-dir"], cwd);
      if (typeof raw === "string" && raw.trim().length > 0 && raw.trim() !== "--git-common-dir") {
        const commonDir = raw.trim();
        const absoluteCommon =
          isAbsolute(commonDir) || /^[A-Za-z]:/.test(commonDir)
            ? commonDir
            : resolve(cwd, commonDir);
        const { canonicalFamilyPath, familyKeyFromPath } = await import("@megasaver/context-gate");
        const canon = canonicalFamilyPath(absoluteCommon, platform ?? process.platform, {
          realpathNative: (p: string) => p,
          caseMode: (_p: string) =>
            platform === "darwin" || platform === "win32"
              ? ("insensitive" as const)
              : ("sensitive" as const),
        });
        const fk = familyKeyFromPath(
          platform ?? process.platform,
          canon.caseMode,
          canon.canonicalPath,
        );
        return fk.key;
      }
    } catch {}
  }
  return encodeWorkspaceKey(cwd);
}

function parseTtlToExpiresAt(ttl: string | undefined, nowMs: number): string | null {
  if (ttl === undefined) return null;
  const trimmed = ttl.trim();
  if (trimmed.length === 0) return null;
  // ISO datetime?
  const isoMs = Date.parse(trimmed);
  if (!Number.isNaN(isoMs)) {
    // check if it's ISO datetime (contains T or Z or offset)
    if (
      /^\d{4}-\d{2}-\d{2}T/.test(trimmed) ||
      /Z$/.test(trimmed) ||
      /[+-]\d{2}:\d{2}$/.test(trimmed)
    ) {
      return new Date(isoMs).toISOString();
    }
  }
  // duration like 30m, 1h, 7d, 60s
  const m = trimmed.match(/^(\d+)([smhd])$/);
  if (m) {
    const nStr = m[1];
    const unit = m[2];
    if (nStr === undefined || unit === undefined) throw new Error(`Invalid ttl: ${trimmed}`);
    const n = Number.parseInt(nStr, 10);
    let ms = 0;
    if (unit === "s") ms = n * 1000;
    else if (unit === "m") ms = n * 60 * 1000;
    else if (unit === "h") ms = n * 60 * 60 * 1000;
    else if (unit === "d") ms = n * 24 * 60 * 60 * 1000;
    return new Date(nowMs + ms).toISOString();
  }
  // try numeric seconds?
  const num = Number(trimmed);
  if (!Number.isNaN(num) && Number.isFinite(num)) {
    return new Date(nowMs + num * 1000).toISOString();
  }
  // fallback: treat as ISO even if not strictly
  if (!Number.isNaN(isoMs)) return new Date(isoMs).toISOString();
  throw new Error(`Invalid ttl: ${ttl}`);
}

function toStringArray(v: unknown): string[] {
  if (v === undefined) return [];
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string") as string[];
  if (typeof v === "string") return [v];
  return [];
}

export type RunBoardPostInput = {
  storeFlag: string | undefined;
  cwd: string;
  home?: string;
  xdgDataHome?: string | undefined;
  platform?: NodeJS.Platform;
  localAppData?: string | undefined;
  text: string;
  topic: string;
  confidence?: string | undefined;
  ttl?: string | undefined;
  pathFlags?: unknown;
  json?: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  execGit?: (args: string[], cwd: string) => string;
  now?: () => number;
  liveSessionId?: string | undefined;
};

export async function runBoardPost(input: RunBoardPostInput): Promise<0 | 1> {
  let parsed: { text: string; topic: string; confidence: "low" | "medium" | "high" };
  try {
    const rawConfidence = input.confidence !== undefined ? input.confidence : "medium";
    if (rawConfidence !== "low" && rawConfidence !== "medium" && rawConfidence !== "high") {
      throw new Error(`Invalid confidence: ${rawConfidence}`);
    }
    parsed = { text: input.text, topic: input.topic, confidence: rawConfidence };
    postInputSchema.parse({ text: input.text, topic: input.topic, confidence: rawConfidence });
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
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

  let repoKey: string;
  try {
    repoKey = await resolveRepoKey(input.cwd, input.platform, input.execGit);
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const paths = toStringArray(input.pathFlags);
  const nowMs = input.now ? input.now() : Date.now();
  let expiresAt: string | null = null;
  try {
    expiresAt = parseTtlToExpiresAt(input.ttl, nowMs);
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const liveSessionId = input.liveSessionId ?? "cli";

  try {
    const fact = postFact(storeRoot, {
      text: parsed.text,
      topic: parsed.topic,
      confidence: parsed.confidence,
      scope: { repo: repoKey, ...(paths.length > 0 ? { paths } : {}) },
      expiresAt,
      liveSessionId,
    });
    if (input.json) {
      input.stdout(JSON.stringify(fact, null, 2));
    } else {
      input.stdout(fact.id);
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const boardPostCommand = defineCommand({
  meta: { name: "post", description: "Post a structured fact to the board (§13)." },
  args: {
    text: { type: "positional", required: true, description: "Fact text (redacted, ≤4000 chars)." },
    topic: {
      type: "string",
      required: true,
      description: "Topic (normalized: trim+lowercase+collapse whitespace).",
    },
    confidence: { type: "string", default: "medium", description: "Confidence: low|medium|high." },
    ttl: { type: "string", description: "TTL: ISO datetime or duration like 30m/1h/7d." },
    path: { type: "string", description: "Repo-relative path scope (repeatable)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON." },
  },
  async run({ args }) {
    const storeFlag = typeof args.store === "string" ? (args.store as string) : undefined;
    const env = readStoreEnv(storeFlag);
    const code = await runBoardPost({
      storeFlag: env.storeFlag,
      cwd: env.cwd,
      home: env.home,
      xdgDataHome: env.xdgDataHome,
      platform: env.platform,
      localAppData: env.localAppData,
      text: typeof args.text === "string" ? args.text : "",
      topic:
        typeof (args as { topic?: unknown }).topic === "string"
          ? ((args as { topic: string }).topic as string)
          : "",
      confidence:
        typeof (args as { confidence?: unknown }).confidence === "string"
          ? ((args as { confidence: string }).confidence as string)
          : undefined,
      ttl:
        typeof (args as { ttl?: unknown }).ttl === "string"
          ? ((args as { ttl: string }).ttl as string)
          : undefined,
      pathFlags: (args as { path?: unknown }).path,
      json: Boolean((args as { json?: unknown }).json),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
