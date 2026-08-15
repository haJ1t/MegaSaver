import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  NPM_TOP,
  PYPI_TOP,
  appendFirewallEvent,
  classifyPackageEdit,
  createLocalResolver,
  extractPackageRefs,
  isAllowlisted,
  nearestKnownName,
  readKnownNames,
  type PackageRef,
} from "@megasaver/context-gate";
import { withFileLock } from "@megasaver/shared/node";
import { z } from "zod";

export type BuildPackageFirewallInput = { payload: unknown; storeRoot: string; now: () => number };
export const WARNED_SET_CAP = 500;

const SESSION_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;

const payloadSchema = z
  .object({
    session_id: z.string(),
    cwd: z.string(),
    tool_name: z.string(),
    tool_input: z.unknown(),
  })
  .passthrough();

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

export function warnedSetPath(storeRoot: string, sessionId: string): string {
  return join(storeRoot, "firewall", "warned", `${sessionId}.json`);
}

function readWarnedSet(path: string): ReadonlySet<string> {
  if (!existsSync(path)) return new Set();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((n): n is string => typeof n === "string"));
  } catch {
    return new Set();
  }
}

function writeWarnedSet(path: string, names: ReadonlySet<string>): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify([...names].slice(-WARNED_SET_CAP)));
  try {
    renameSync(tmp, path);
  } catch {
    unlinkSync(path);
    renameSync(tmp, path);
  }
}

function newTextOf(input: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of ["new_string", "content"]) {
    if (typeof input[key] === "string") parts.push(input[key]);
  }
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const edits = input["edits"];
  if (Array.isArray(edits)) {
    for (const e of edits) {
      if (typeof e === "object" && e !== null && typeof (e as Record<string, unknown>)["new_string"] === "string") {
        parts.push((e as Record<string, unknown>)["new_string"] as string);
      }
    }
  }
  return parts.join("\n");
}

export async function buildPackageFirewallText(input: BuildPackageFirewallInput): Promise<string> {
  try {
    const parsed = payloadSchema.safeParse(input.payload);
    if (!parsed.success) return "";
    const { session_id: sessionId, cwd, tool_name: toolName, tool_input: toolInput } = parsed.data;
    if (!EDIT_TOOLS.has(toolName)) return "";
    if (typeof toolInput !== "object" || toolInput === null) return "";
    const rawInput = toolInput as Record<string, unknown>;
    const filePath = typeof rawInput["file_path"] === "string" ? rawInput["file_path"] : undefined;
    if (filePath === undefined) return "";
    const kind = classifyPackageEdit(filePath);
    if (kind === null) return "";
    const refs = extractPackageRefs(kind, newTextOf(rawInput));
    if (refs.length === 0) return "";

    const warnedPath = SESSION_SEGMENT.test(sessionId) ? warnedSetPath(input.storeRoot, sessionId) : null;
    const warned = warnedPath === null ? new Set<string>() : readWarnedSet(warnedPath);

    const startDir = filePath.includes("/") || filePath.includes("\\") ? dirname(filePath) : cwd;
    const localResolver = createLocalResolver(startDir);
    const known = new Map<PackageRef["ecosystem"], ReadonlySet<string>>();

    const unknownRefs: PackageRef[] = [];
    for (const ref of refs) {
      if (warned.has(`${ref.ecosystem}:${ref.name}`)) continue;
      if (isAllowlisted(input.storeRoot, ref)) continue;
      if (localResolver.resolves(ref)) continue;
      let knownNames = known.get(ref.ecosystem);
      if (knownNames === undefined) {
        knownNames = readKnownNames(input.storeRoot, ref.ecosystem);
        known.set(ref.ecosystem, knownNames);
      }
      if (knownNames.has(ref.name)) continue;
      unknownRefs.push(ref);
    }
    if (unknownRefs.length === 0) return "";

    const shown = unknownRefs.slice(0, 3);
    const lines: string[] = [];
    for (const ref of shown) {
      const suggestion =
        ref.ecosystem === "npm"
          ? nearestKnownName(ref.name, NPM_TOP)
          : nearestKnownName(ref.name, PYPI_TOP);
      const head = `⛨ Package Firewall: "${ref.name}" (${ref.ecosystem}) is not in this project's dependencies, lockfiles, or the known-registry cache — it may be hallucinated. Verify it exists before installing.`;
      const hint = suggestion === null ? "" : ` Did you mean "${suggestion}"?`;
      const tail = ` Verify online: mega firewall refresh ${ref.name}. Private registry? mega firewall allow ${ref.name} --ecosystem ${ref.ecosystem}`;
      lines.push(`${head}${hint}${tail}`);
    }
    if (unknownRefs.length > 3) {
      lines.push(`…and ${unknownRefs.length - 3} more unknown package(s)`);
    }
    const text = lines.join("\n");

    // Best-effort side effects in their own try/catch: a store failure must
    // never suppress the warn.
    try {
      const at = new Date(input.now()).toISOString();
      for (const ref of unknownRefs) {
        appendFirewallEvent(input.storeRoot, {
          at,
          kind: "unknown-package",
          detector: "package-firewall",
          count: 1,
          packageName: ref.name,
          ecosystem: ref.ecosystem,
          sessionId,
        });
        const suggestion =
          ref.ecosystem === "npm"
            ? nearestKnownName(ref.name, NPM_TOP)
            : nearestKnownName(ref.name, PYPI_TOP);
        if (suggestion !== null) {
          appendFirewallEvent(input.storeRoot, {
            at,
            kind: "typosquat-suspect",
            detector: "package-firewall",
            count: 1,
            packageName: ref.name,
            ecosystem: ref.ecosystem,
            suggestion,
            sessionId,
          });
        }
      }
      if (warnedPath !== null) {
        const next = new Set(warned);
        for (const ref of unknownRefs) next.add(`${ref.ecosystem}:${ref.name}`);
        mkdirSync(dirname(warnedPath), { recursive: true });
        const locked = withFileLock(`${warnedPath}.lock`, { deadlineMs: 250, staleMs: 5_000 }, () => {
          writeWarnedSet(warnedPath, next);
        });
        void locked;
      }
    } catch {
      // best-effort
    }
    return text;
  } catch {
    return "";
  }
}
