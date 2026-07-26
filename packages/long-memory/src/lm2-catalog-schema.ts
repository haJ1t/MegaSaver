import { createHash } from "node:crypto";
import { workspaceKeySchema } from "@megasaver/shared";
import { z } from "zod";
import { lm1KindSchema } from "./lm1-model.js";
import { Lm2Error } from "./lm2-errors.js";

export const MAX_LM2_CATALOG_ENTRIES = 10_000;
export const MAX_LM2_CATALOG_BYTES = 4 * 1024 * 1024;
export const MAX_LM2_CATALOG_CONTROL_BYTES = 1_024;

const identityTextSchema = z.string().regex(/^(?:0|[1-9][0-9]*)$/);
const legacyIdentityNumberSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const lowercaseUuidSchema = z
  .string()
  .uuid()
  .refine((value) => value === value.toLowerCase(), "id must be lowercase");
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const tokenSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const lm2CatalogEntrySchema = z
  .object({
    id: lowercaseUuidSchema,
    sourceDigest: digestSchema,
    kind: lm1KindSchema,
    observedAt: z.string().datetime({ offset: true }),
    captureSequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export type Lm2CatalogEntry = z.infer<typeof lm2CatalogEntrySchema>;

export const lm2CatalogSchema = z
  .object({
    schemaVersion: z.literal(2),
    generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    entries: z.array(lm2CatalogEntrySchema).max(MAX_LM2_CATALOG_ENTRIES),
  })
  .strict();
export type Lm2Catalog = z.infer<typeof lm2CatalogSchema>;

export const lm2CatalogControlSchema = z
  .object({
    schemaVersion: z.literal(2),
    catalogLock: z
      .object({ device: identityTextSchema, inode: identityTextSchema, token: tokenSchema })
      .strict(),
    emptyCatalogDigest: digestSchema,
  })
  .strict();
export type Lm2CatalogControl = z.infer<typeof lm2CatalogControlSchema>;

const legacyLm2CatalogControlSchema = z
  .object({
    schemaVersion: z.literal(2),
    catalogLock: z
      .object({
        device: legacyIdentityNumberSchema,
        inode: legacyIdentityNumberSchema,
        token: tokenSchema,
      })
      .strict(),
    emptyCatalogDigest: digestSchema,
  })
  .strict();

const cursorSchema = z
  .object({
    schemaVersion: z.literal(2),
    workspaceKey: workspaceKeySchema,
    generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    nextCaptureSequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
type CatalogCursor = z.infer<typeof cursorSchema>;

function isCanonicalTimestamp(value: string): boolean {
  try {
    return value === new Date(value).toISOString();
  } catch {
    return false;
  }
}

function validateCatalog(catalog: Lm2Catalog): Lm2Catalog {
  const seenIds = new Set<string>();
  let expectedSequence: number | undefined;
  for (const entry of catalog.entries) {
    if (
      seenIds.has(entry.id) ||
      (expectedSequence !== undefined && entry.captureSequence !== expectedSequence) ||
      !isCanonicalTimestamp(entry.observedAt)
    ) {
      throw new Lm2Error("store_corrupt", "LM2 candidate catalog is invalid.");
    }
    seenIds.add(entry.id);
    expectedSequence = entry.captureSequence + 1;
  }
  return catalog;
}

function canonicalParse<T>(raw: string, schema: z.ZodType<T>, message: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Lm2Error("store_corrupt", message);
  }
  const result = schema.safeParse(parsed);
  if (!result.success || raw !== `${JSON.stringify(result.data)}\n`) {
    throw new Lm2Error("store_corrupt", message);
  }
  return result.data;
}

export function emptyLm2Catalog(): Lm2Catalog {
  return { schemaVersion: 2, generation: 0, entries: [] };
}

export function serializeLm2Catalog(catalog: Lm2Catalog): string {
  const serialized = `${JSON.stringify(validateCatalog(lm2CatalogSchema.parse(catalog)))}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_LM2_CATALOG_BYTES) {
    throw new Lm2Error("write_failed", "LM2 candidate catalog exceeds its storage limit.");
  }
  return serialized;
}

export function parseLm2Catalog(raw: string): Lm2Catalog {
  if (Buffer.byteLength(raw, "utf8") > MAX_LM2_CATALOG_BYTES) {
    throw new Lm2Error("store_corrupt", "LM2 candidate catalog exceeds its storage limit.");
  }
  return validateCatalog(
    canonicalParse(raw, lm2CatalogSchema, "LM2 candidate catalog is invalid."),
  );
}

export function serializeLm2CatalogControl(control: Lm2CatalogControl): string {
  return `${JSON.stringify(lm2CatalogControlSchema.parse(control))}\n`;
}

export function parseLm2CatalogControl(raw: string): Lm2CatalogControl {
  try {
    return canonicalParse(
      raw,
      lm2CatalogControlSchema,
      "LM2 candidate catalog control is invalid.",
    );
  } catch {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Lm2Error("store_corrupt", "LM2 candidate catalog control is invalid.");
    }
    const legacy = legacyLm2CatalogControlSchema.safeParse(parsed);
    if (!legacy.success || raw !== `${JSON.stringify(legacy.data)}\n`) {
      throw new Lm2Error("store_corrupt", "LM2 candidate catalog control is invalid.");
    }
    return {
      ...legacy.data,
      catalogLock: {
        ...legacy.data.catalogLock,
        device: legacy.data.catalogLock.device.toString(),
        inode: legacy.data.catalogLock.inode.toString(),
      },
    };
  }
}

export function catalogContentDigest(serialized: string): string {
  return createHash("sha256").update(serialized).digest("hex");
}

function encodeCursor(cursor: CatalogCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function nextCatalogCursor(input: Omit<CatalogCursor, "schemaVersion">): string {
  return encodeCursor({ schemaVersion: 2, ...input });
}

export function catalogStartIndex(
  catalog: Lm2Catalog,
  workspaceKey: string,
  cursor: string | null,
): number {
  if (cursor === null) return 0;
  let parsed: unknown;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    parsed = JSON.parse(raw);
  } catch {
    throw new Lm2Error("invalid_input", "Invalid LM2 catalog cursor.");
  }
  const result = cursorSchema.safeParse(parsed);
  if (!result.success || cursor !== encodeCursor(result.data)) {
    throw new Lm2Error("invalid_input", "Invalid LM2 catalog cursor.");
  }
  const decoded = result.data;
  if (decoded.workspaceKey !== workspaceKey) {
    throw new Lm2Error("invalid_input", "LM2 catalog cursor workspace does not match request.");
  }
  if (decoded.generation > catalog.generation) {
    throw new Lm2Error("cursor_expired", "LM2 catalog cursor generation is unavailable.");
  }
  const index = catalog.entries.findIndex(
    (entry) => entry.captureSequence === decoded.nextCaptureSequence,
  );
  if (index >= 0) return index;
  const terminalSequence = (catalog.entries.at(-1)?.captureSequence ?? 0) + 1;
  if (decoded.nextCaptureSequence === terminalSequence) return catalog.entries.length;
  throw new Lm2Error("cursor_expired", "LM2 catalog cursor is outside the retained window.");
}
