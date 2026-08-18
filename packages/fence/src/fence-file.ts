import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { FenceError } from "./error.js";

export const FENCE_FILE_NAME = "fence.yaml";
export const FENCE_CLASSES = [
  "lockfile",
  "build-output",
  "codegen-header",
  "linguist-generated",
  "vendored",
] as const;
export const fenceClassSchema = z.enum(FENCE_CLASSES);
export type FenceClass = (typeof FENCE_CLASSES)[number];

export const FENCE_MAX_GLOB_LENGTH = 256;
export const FENCE_MAX_ENTRIES = 512;
export const FENCE_MAX_ALLOW_GLOBS = 256;

const fenceGlob = z
  .string()
  .min(1)
  .max(FENCE_MAX_GLOB_LENGTH)
  .refine((v) => !v.includes("[") && !v.includes("]"), {
    message: "bracket expressions are not supported in fence globs",
  });

export const fenceEntrySchema = z
  .object({
    path: fenceGlob,
    class: fenceClassSchema,
    reason: z.string().min(1),
    mode: z.enum(["warn", "deny"]).optional(),
    alternative: z.string().min(1).optional(),
  })
  .strict();
export type FenceEntry = z.infer<typeof fenceEntrySchema>;

export const fenceFileSchema = z
  .object({
    version: z.literal(1),
    allow: z.array(fenceGlob).max(FENCE_MAX_ALLOW_GLOBS).default([]),
    entries: z.array(fenceEntrySchema).max(FENCE_MAX_ENTRIES).default([]),
  })
  .strict();
export type FenceFile = z.infer<typeof fenceFileSchema>;

export function parseFenceFile(raw: unknown): FenceFile {
  const res = fenceFileSchema.safeParse(raw);
  if (!res.success) {
    throw new FenceError("schema_invalid", res.error.message, {
      cause: res.error,
    });
  }
  return res.data;
}

export function serializeFenceFile(file: FenceFile): string {
  const sortedEntries = [...file.entries].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  const normalized = {
    version: file.version,
    allow: file.allow,
    entries: sortedEntries,
  };
  return stringifyYaml(normalized);
}

export function loadFenceFile(dir: string): FenceFile | null {
  const filePath = join(dir, FENCE_FILE_NAME);
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err: unknown) {
    if (
      err !== null &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "ENOENT"
    ) {
      return null;
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new FenceError("io_failed", `unable to read ${filePath}: ${message}`, {
      cause: err,
    });
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new FenceError("schema_invalid", `invalid yaml in ${filePath}: ${message}`, {
      cause: err,
    });
  }

  return parseFenceFile(parsed);
}

export function locateFenceRoot(cwd: string): string | null {
  let curr = cwd;
  while (true) {
    if (existsSync(join(curr, FENCE_FILE_NAME))) {
      return curr;
    }
    if (existsSync(join(curr, ".git"))) {
      return null;
    }
    const parent = dirname(curr);
    if (parent === curr) {
      return null;
    }
    curr = parent;
  }
}
