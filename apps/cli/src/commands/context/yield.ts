import { execFile } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { computeYieldAudit } from "@megasaver/context-pruner";
import { defineCommand } from "citty";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { findProjectByCwd } from "../warmup.js";

const execFileAsync = promisify(execFile);

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function parseWindowFlag(
  flag: string | undefined,
  nowMs: number,
): { from: string; to: string } | null {
  const to = new Date(nowMs).toISOString();
  if (!flag) {
    const from = new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString();
    return { from, to };
  }
  const m = /^(\d+)(d)$/.exec(flag.trim());
  if (m) {
    const days = Number.parseInt(m[1] ?? "0", 10);
    if (!Number.isFinite(days) || days <= 0 || days > 30) return null;
    const from = new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
    return { from, to };
  }
  // try ISO date
  const parsed = Date.parse(flag);
  if (!Number.isNaN(parsed)) {
    return { from: new Date(parsed).toISOString(), to };
  }
  return null;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function renderHuman(report: ReturnType<typeof computeYieldAudit>): string[] {
  const lines: string[] = [];
  lines.push(`# Context yield audit ${report.window.from} → ${report.window.to}`);
  lines.push(`honestNote: ${report.honestNote}`);
  if (report.rows.length === 0) {
    lines.push("no memories/rules injected in window");
    return lines;
  }
  lines.push(
    `rows: ${report.rows.length}${report.aggregatedRemaining > 0 ? ` (+${report.aggregatedRemaining} more)` : ""}`,
  );
  lines.push("id       yield  tier        reused  signals");
  lines.push("-------- ------ ----------- ------- ----------------");
  for (const r of report.rows) {
    const sig = `${r.signals.readIndex ? "R" : "-"}${r.signals.decisionTrace ? "T" : "-"}${r.signals.diffFingerprint ? "D" : "-"}`;
    lines.push(
      `${shortId(r.id).padEnd(8)} ${r.yield.toFixed(2).padEnd(6)} ${r.tier.padEnd(11)} ${String(r.reusedAtLeast).padEnd(7)} ${sig}`,
    );
  }
  if (report.honestReceipt?.warnings?.length) {
    for (const w of report.honestReceipt.warnings) lines.push(`warning: ${w}`);
  }
  return lines;
}

export type RunContextYieldInput = {
  cwd: string;
  home: string;
  storeFlag?: string;
  xdgDataHome?: string;
  platform: NodeJS.Platform;
  localAppData?: string;
  project?: string;
  windowFlag?: string;
  json?: boolean;
  now?: () => number;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runContextYield(input: RunContextYieldInput): Promise<0 | 1> {
  const nowMs = input.now ? input.now() : Date.now();
  const window = parseWindowFlag(input.windowFlag, nowMs);
  if (!window) {
    input.stderr("error: window must be Nd (1..30d) or ISO datetime, e.g. --window 7d");
    return 1;
  }

  let storeRoot: string;
  try {
    storeRoot = resolveStorePath({
      storeFlag: input.storeFlag,
      cwd: input.cwd,
      home: input.home,
      xdgDataHome: input.xdgDataHome,
      platform: input.platform,
      localAppData: input.localAppData,
    });
  } catch (err) {
    input.stderr(err instanceof Error ? err.message : String(err));
    return 1;
  }

  let registry: Awaited<ReturnType<typeof ensureStoreReady>>["registry"];
  try {
    const ready = await ensureStoreReady(storeRoot);
    registry = ready.registry;
  } catch (err) {
    input.stderr(err instanceof Error ? err.message : String(err));
    return 1;
  }

  let projectId: string | null = null;
  let projectRoot: string | null = null;
  if (input.project) {
    const byName = registry.listProjects().find((p) => p.name === input.project);
    const byId = registry.listProjects().find((p) => p.id === input.project);
    const proj = byName ?? byId ?? null;
    if (!proj) {
      input.stderr(`error: no registered project for "${input.project}"; run mega project create`);
      return 1;
    }
    projectId = proj.id;
    projectRoot = proj.rootPath;
  } else {
    const proj = findProjectByCwd(registry.listProjects(), input.cwd);
    if (!proj) {
      input.stderr("error: no registered project for this workspace; run mega project create");
      return 1;
    }
    projectId = proj.id;
    projectRoot = proj.rootPath;
  }

  // injected
  const memoryEntries = registry.listMemoryEntries(projectId as never);
  const projectRules = registry.listProjectRules(projectId as never);
  const injected: readonly {
    readonly id: string;
    readonly content: string;
    readonly relatedFiles?: readonly string[];
  }[] = [
    ...memoryEntries.map((m) => {
      const base: { id: string; content: string; relatedFiles?: readonly string[] } = {
        id: m.id,
        content: m.content,
      };
      if (m.relatedFiles) base.relatedFiles = m.relatedFiles as readonly string[];
      return base;
    }),
    ...projectRules.map((r) => {
      const base: { id: string; content: string; relatedFiles?: readonly string[] } = {
        id: r.id,
        content: `${r.title} ${r.rule}`,
      };
      if (r.appliesTo) base.relatedFiles = r.appliesTo as readonly string[];
      return base;
    }),
  ];

  // evidence: best-effort listChunkSets across sessions
  const evidence: {
    chunkSetId: string;
    decisionTraceIds?: readonly string[];
    relatedFilesInChunk?: readonly string[];
  }[] = [];
  const warnings: string[] = [];
  try {
    const sessions = registry.listSessions(projectId as never);
    const { readdirSync: _r, readFileSync: _rf } = await import("node:fs");
    void _r;
    void _rf;
    // Use content-store listChunkSets if available, but don't fail if not
    // We try to list via readdir of content/<projectId>/*/*.json and treat each as evidence
    const contentRoot = join(storeRoot, "content", projectId);
    try {
      const sessionDirs = readdirSync(contentRoot);
      for (const sessDir of sessionDirs) {
        const sessPath = join(contentRoot, sessDir);
        try {
          if (!statSync(sessPath).isDirectory()) continue;
        } catch {
          continue;
        }
        try {
          const files = readdirSync(sessPath);
          for (const f of files) {
            if (!f.endsWith(".json")) continue;
            if (f === "read-index.json" || f === "shown-index.json") continue;
            if (f.startsWith("preflight-")) continue;
            if (f.startsWith("fork-")) continue;
            const chunkSetId = f.slice(0, -5);
            // try to parse chunkSet for decision trace? chunkSets don't carry it, so leave empty
            evidence.push({ chunkSetId });
          }
        } catch {
          warnings.push(`skipped unreadable session dir ${sessDir}`);
        }
      }
    } catch (error) {
      if (!(isErrno(error) && error.code === "ENOENT"))
        warnings.push("skipped unreadable content root");
    }
    void sessions;
  } catch {
    warnings.push("skipped unreadable chunk-sets");
  }

  // readIndexEntries: load read-index.json per session
  const readIndexEntries: { path: string; sessionId: string; at: string }[] = [];
  try {
    const contentRoot = join(storeRoot, "content", projectId);
    try {
      const sessionDirs = readdirSync(contentRoot);
      for (const sessDir of sessionDirs) {
        const idxPath = join(contentRoot, sessDir, "read-index.json");
        try {
          const raw = readFileSync(idxPath, "utf8");
          const json = JSON.parse(raw) as Record<
            string,
            { contentHash: string; chunkSetId: string }
          >;
          for (const [pathHash, entry] of Object.entries(json)) {
            // pathHash is sha256, we don't have reverse mapping; use placeholder path from entry if available?
            // Instead we treat the content as not directly mapping; fall back to reading the stored path from chunk-set?
            // For MVP we approximate: if the read-index key is a pathHash, we cannot recover path, so we skip unless the entry has a path field
            // Check if entry has a path property (some versions do)
            const maybePath = (entry as { path?: string }).path;
            if (typeof maybePath === "string") {
              readIndexEntries.push({ path: maybePath, sessionId: sessDir, at: window.from });
            } else {
              void pathHash;
            }
          }
        } catch (error) {
          if (!(isErrno(error) && error.code === "ENOENT"))
            warnings.push(`skipped unreadable read-index ${sessDir}`);
        }
      }
    } catch {}
  } catch {
    warnings.push("skipped unreadable read-index");
  }

  // diffAddedLines: git diff added corpus for fingerprint signal
  const diffAddedLines: string[] = [];
  if (projectRoot) {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["-C", projectRoot, "diff", "--no-color", "--unified=0", "HEAD"],
        {
          timeout: 2000,
          maxBuffer: 1_000_000,
        },
      );
      for (const line of String(stdout).split("\n")) {
        if (line.startsWith("+") && !line.startsWith("++")) diffAddedLines.push(line.slice(1));
      }
      // cap corpus
      if (diffAddedLines.length > 200) diffAddedLines.length = 200;
    } catch {
      // fail-open: no diff corpus
    }
  }

  const report = computeYieldAudit({
    injected,
    evidence,
    readIndexEntries,
    diffAddedLines,
    window,
  });
  if (warnings.length > 0) {
    report.honestReceipt = { warnings: [...(report.honestReceipt?.warnings ?? []), ...warnings] };
  }

  if (input.json) {
    input.stdout(JSON.stringify(report, null, 2));
    return 0;
  }
  for (const line of renderHuman(report)) input.stdout(line);
  return 0;
}

export const contextYieldCommand = defineCommand({
  meta: {
    name: "yield",
    description: "Report freeloader table for injected memories/rules (honest lower bound).",
  },
  args: {
    project: { type: "string", description: "Project name or id (default: resolve by cwd)." },
    window: {
      type: "string",
      description: "Window Nd (1..30d) or ISO datetime, e.g. 7d (default 7d).",
    },
    json: { type: "boolean", default: false, description: "Emit JSON YieldAuditReport." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    // @ts-ignore: noPropertyAccessFromIndexSignature
    const project = typeof args.project === "string" ? String(args.project) : undefined;
    // @ts-ignore: noPropertyAccessFromIndexSignature
    const windowFlag = typeof args.window === "string" ? String(args.window) : undefined;
    // @ts-ignore: noPropertyAccessFromIndexSignature
    const json = !!args.json;
    // @ts-ignore: noPropertyAccessFromIndexSignature
    const storeFlag = typeof args.store === "string" ? String(args.store) : undefined;
    const cwd = process.cwd();
    const home = readStoreEnv(storeFlag).home;
    const { xdgDataHome, platform, localAppData } = readStoreEnv(storeFlag);
    const code = await runContextYield({
      cwd,
      home,
      ...(storeFlag !== undefined ? { storeFlag } : {}),
      ...(xdgDataHome !== undefined ? { xdgDataHome } : {}),
      platform,
      ...(localAppData !== undefined ? { localAppData } : {}),
      ...(project !== undefined ? { project } : {}),
      ...(windowFlag !== undefined ? { windowFlag } : {}),
      json,
      stdout: (l) => console.log(l),
      stderr: (l) => console.error(l),
    });
    if (code !== 0) process.exitCode = code;
  },
});
