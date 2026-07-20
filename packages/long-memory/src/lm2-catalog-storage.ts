import { randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import { basename } from "node:path";
import {
  type Lm2Catalog,
  type Lm2CatalogControl,
  MAX_LM2_CATALOG_BYTES,
  MAX_LM2_CATALOG_CONTROL_BYTES,
  catalogContentDigest,
  parseLm2Catalog,
  parseLm2CatalogControl,
  serializeLm2Catalog,
  serializeLm2CatalogControl,
} from "./lm2-catalog-schema.js";
import { Lm2Error } from "./lm2-errors.js";
import { lm2CandidateCatalogDirectory } from "./lm2-paths.js";
import {
  type DirectoryAnchor,
  anchoredChildPath,
  closeDirectoryAnchor,
  openDirectoryAnchor,
  readAnchoredFile,
  sameFileIdentity,
  verifyDirectoryAnchor,
} from "./lm2-secure-fs.js";
import {
  closeAndRemoveAnchoredTemporary,
  materializeAnchoredFile,
  publishAnchoredTemporary,
  replaceAnchoredFile,
} from "./lm2-secure-publish-files.js";

export const LM2_CATALOG_NAME = "candidate-catalog-v2.json";
export const LM2_CATALOG_CONTROL_NAME = "candidate-catalog-v2.control.json";
export const LM2_CATALOG_LOCK_NAME = "candidate-catalog-v2.lock";
const V1_NAMES = ["candidate-catalog-v1.json", "candidate-catalog-v1.lock"] as const;

export type CatalogStorage = { readonly anchor: DirectoryAnchor };
export type StoredCatalog = { readonly value: Lm2Catalog; readonly stat: import("node:fs").Stats };

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function childExists(anchor: DirectoryAnchor, name: string): boolean {
  verifyDirectoryAnchor(anchor);
  try {
    lstatSync(anchoredChildPath(anchor, name));
    verifyDirectoryAnchor(anchor);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      verifyDirectoryAnchor(anchor);
      return false;
    }
    if (error instanceof Lm2Error) throw error;
    throw new Lm2Error("store_corrupt", "LM2 candidate catalog path is unreadable.");
  }
}

export function openCatalogStorage(storeRoot: string, workspaceKey: string): CatalogStorage {
  const directory = lm2CandidateCatalogDirectory(storeRoot, workspaceKey);
  const anchor = openDirectoryAnchor(directory, false);
  if (anchor === null) throw new Lm2Error("store_corrupt", "LM2 catalog directory is missing.");
  try {
    if (V1_NAMES.some((name) => childExists(anchor, name))) {
      throw new Lm2Error(
        "catalog_schema_unsupported",
        "LM2 candidate catalog V1 requires an explicit migration.",
      );
    }
    return { anchor };
  } catch (error) {
    closeDirectoryAnchor(anchor);
    throw error;
  }
}

export function closeCatalogStorage(storage: CatalogStorage): void {
  closeDirectoryAnchor(storage.anchor);
}

function readChild(
  storage: CatalogStorage,
  name: string,
  maximumBytes: number,
): { raw: string; stat: import("node:fs").Stats } | null {
  const read = readAnchoredFile(storage.anchor, name, maximumBytes);
  if (read.status === "missing") return null;
  if (read.status === "invalid") {
    throw new Lm2Error("store_corrupt", "LM2 candidate catalog state is invalid.");
  }
  return { raw: read.raw.toString("utf8"), stat: read.stat };
}

export function readCatalogControl(storage: CatalogStorage): Lm2CatalogControl | null {
  const read = readChild(storage, LM2_CATALOG_CONTROL_NAME, MAX_LM2_CATALOG_CONTROL_BYTES);
  return read === null ? null : parseLm2CatalogControl(read.raw);
}

export function readStoredCatalog(storage: CatalogStorage): StoredCatalog | null {
  const read = readChild(storage, LM2_CATALOG_NAME, MAX_LM2_CATALOG_BYTES);
  return read === null ? null : { value: parseLm2Catalog(read.raw), stat: read.stat };
}

function createSerialized(storage: CatalogStorage, name: string, serialized: string): void {
  const temp = materializeAnchoredFile(
    storage.anchor,
    `.${randomUUID()}.catalog-create`,
    serialized,
  );
  let failure: unknown;
  try {
    publishAnchoredTemporary(storage.anchor, temp, name, () =>
      verifyDirectoryAnchor(storage.anchor),
    );
  } catch (error) {
    failure = error;
  }
  try {
    closeAndRemoveAnchoredTemporary(storage.anchor, temp);
  } catch (error) {
    failure ??= error;
  }
  if (failure !== undefined) throw failure;
}

export function createCatalogControl(storage: CatalogStorage, control: Lm2CatalogControl): void {
  createSerialized(storage, LM2_CATALOG_CONTROL_NAME, serializeLm2CatalogControl(control));
}

export function createCatalogFile(storage: CatalogStorage, catalog: Lm2Catalog): void {
  createSerialized(storage, LM2_CATALOG_NAME, serializeLm2Catalog(catalog));
}

export function replaceCatalogFile(
  storage: CatalogStorage,
  previous: StoredCatalog,
  catalog: Lm2Catalog,
  assertMutationAllowed: () => void,
): void {
  const current = lstatSync(anchoredChildPath(storage.anchor, LM2_CATALOG_NAME));
  if (!current.isFile() || !sameFileIdentity(current, previous.stat)) {
    throw new Lm2Error("store_corrupt", "LM2 candidate catalog identity changed.");
  }
  const serialized = serializeLm2Catalog(catalog);
  replaceAnchoredFile(
    storage.anchor,
    LM2_CATALOG_NAME,
    serialized,
    catalogContentDigest(serialized),
    MAX_LM2_CATALOG_BYTES,
    () => {
      assertMutationAllowed();
      const latest = lstatSync(anchoredChildPath(storage.anchor, LM2_CATALOG_NAME));
      if (!latest.isFile() || !sameFileIdentity(latest, previous.stat)) {
        throw new Lm2Error("store_corrupt", "LM2 candidate catalog identity changed.");
      }
    },
  );
}

export function catalogLockPath(storage: CatalogStorage): string {
  return anchoredChildPath(storage.anchor, basename(LM2_CATALOG_LOCK_NAME));
}
