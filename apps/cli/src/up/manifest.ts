import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tokenSaverModeSchema } from "@megasaver/shared";
import { withFileLock } from "@megasaver/shared/node";
import { z } from "zod";

const ts = z.string().min(1);

// Prior state is what `mega down` restores — record it, never infer it.
const hooksStepSchema = z.object({
  kind: z.literal("hooks-install"),
  at: ts,
  settingsPath: z.string().min(1),
  priorConnected: z.boolean(),
  changed: z.boolean(),
});

const connectorStepSchema = z.object({
  kind: z.literal("connector-sync"),
  at: ts,
  projectName: z.string().min(1),
  projectCreated: z.boolean(),
  targets: z.array(
    z.object({
      id: z.string().min(1),
      relativePath: z.string().min(1),
      prior: z.enum(["missing", "no-block", "block"]),
    }),
  ),
});

const saverStepSchema = z.object({
  kind: z.literal("saver-enable"),
  at: ts,
  exact: z.boolean(),
  priorEnabled: z.boolean(),
  priorMode: tokenSaverModeSchema,
  mode: tokenSaverModeSchema,
});

export const upManifestSchema = z.object({
  version: z.literal(1),
  workspaceKey: z.string().min(1),
  cwd: z.string().min(1),
  createdAt: ts,
  updatedAt: ts,
  steps: z.array(
    z.discriminatedUnion("kind", [hooksStepSchema, connectorStepSchema, saverStepSchema]),
  ),
  reversedAt: ts.optional(),
});

export type UpManifest = z.infer<typeof upManifestSchema>;

export function upManifestPath(storeRoot: string, workspaceKey: string): string {
  return join(storeRoot, "up", workspaceKey, "manifest.json");
}

export type UpManifestRead =
  | { kind: "absent" }
  | { kind: "ok"; manifest: UpManifest }
  | { kind: "corrupt"; message: string };

export function readUpManifest(storeRoot: string, workspaceKey: string): UpManifestRead {
  const path = upManifestPath(storeRoot, workspaceKey);
  if (!existsSync(path)) return { kind: "absent" };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return { kind: "corrupt", message: err instanceof Error ? err.message : String(err) };
  }
  const parsed = upManifestSchema.safeParse(raw);
  return parsed.success
    ? { kind: "ok", manifest: parsed.data }
    : { kind: "corrupt", message: parsed.error.message };
}

export function writeUpManifest(storeRoot: string, manifest: UpManifest): boolean {
  const dir = join(storeRoot, "up", manifest.workspaceKey);
  mkdirSync(dir, { recursive: true });
  return withFileLock(join(dir, "manifest.lock"), { deadlineMs: 2000, staleMs: 30_000 }, () => {
    const tmp = join(dir, `.manifest.${randomUUID()}.tmp`);
    writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`);
    renameSync(tmp, join(dir, "manifest.json"));
  });
}
