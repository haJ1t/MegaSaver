import { randomBytes } from "node:crypto";
import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  openSync,
  readSync,
  writeSync,
} from "node:fs";
import { flockSync } from "fs-ext";
import {
  type Lm2CatalogControl,
  catalogContentDigest,
  emptyLm2Catalog,
  serializeLm2Catalog,
} from "./lm2-catalog-schema.js";
import {
  type CatalogStorage,
  LM2_CATALOG_LOCK_NAME,
  assertNoV1CatalogState,
  catalogLockPath,
  createCatalogControl,
  createCatalogFile,
  readCatalogControl,
  readStoredCatalog,
} from "./lm2-catalog-storage.js";
import { combineLm2CleanupFailures } from "./lm2-cleanup-errors.js";
import { Lm2Error } from "./lm2-errors.js";
import {
  anchoredChildPath,
  sameFileIdentity,
  secureOpenFlags,
  verifyDirectoryAnchor,
} from "./lm2-secure-fs.js";

const TOKEN_BYTES = 65;
const BUSY_CODES = new Set(["EAGAIN", "EWOULDBLOCK"]);

type LockFile = {
  descriptor: number;
  stat: import("node:fs").Stats;
  path: string;
};

export type CatalogLockGuard = {
  readonly control: Lm2CatalogControl;
  assertIntact(): void;
  release(): void;
};

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function readToken(descriptor: number): string | null {
  const bytes = Buffer.alloc(TOKEN_BYTES + 1);
  const count = readSync(descriptor, bytes, 0, bytes.length, 0);
  if (count === 0) return null;
  const value = bytes.subarray(0, count).toString("utf8");
  return count === TOKEN_BYTES && /^[0-9a-f]{64}\n$/.test(value) ? value.slice(0, -1) : "";
}

function writeToken(descriptor: number): string {
  const token = randomBytes(32).toString("hex");
  const bytes = Buffer.from(`${token}\n`, "utf8");
  ftruncateSync(descriptor, 0);
  let written = 0;
  while (written < bytes.byteLength) {
    written += writeSync(descriptor, bytes, written, bytes.byteLength - written, written);
  }
  fsyncSync(descriptor);
  return token;
}

function openLock(storage: CatalogStorage): { file: LockFile; created: boolean } {
  verifyDirectoryAnchor(storage.anchor);
  const path = catalogLockPath(storage);
  let descriptor: number;
  let created = false;
  try {
    descriptor = openSync(
      path,
      secureOpenFlags(constants.O_RDWR | constants.O_CREAT | constants.O_EXCL),
      0o600,
    );
    created = true;
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
    descriptor = openSync(path, secureOpenFlags(constants.O_RDWR));
  }
  try {
    const stat = fstatSync(descriptor);
    const named = lstatSync(path);
    if (
      !stat.isFile() ||
      !sameFileIdentity(stat, named) ||
      (process.platform !== "win32" && (stat.mode & 0o777) !== 0o600)
    ) {
      throw new Lm2Error("store_corrupt", "LM2 catalog lock identity changed.");
    }
    verifyDirectoryAnchor(storage.anchor);
    return { file: { descriptor, stat, path }, created };
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function assertSafeIdentity(stat: import("node:fs").Stats): void {
  if (
    !Number.isSafeInteger(stat.dev) ||
    stat.dev < 0 ||
    !Number.isSafeInteger(stat.ino) ||
    stat.ino < 0
  ) {
    throw new Lm2Error("store_corrupt", "LM2 catalog lock identity is invalid.");
  }
}

function assertBinding(storage: CatalogStorage, file: LockFile, control: Lm2CatalogControl): void {
  assertNoV1CatalogState(storage);
  const descriptorStat = fstatSync(file.descriptor);
  const namedStat = lstatSync(anchoredChildPath(storage.anchor, LM2_CATALOG_LOCK_NAME));
  if (
    !descriptorStat.isFile() ||
    !sameFileIdentity(descriptorStat, file.stat) ||
    !sameFileIdentity(namedStat, file.stat) ||
    control.catalogLock.device !== file.stat.dev ||
    control.catalogLock.inode !== file.stat.ino ||
    readToken(file.descriptor) !== control.catalogLock.token
  ) {
    throw new Lm2Error("store_corrupt", "LM2 catalog lock binding changed.");
  }
  verifyDirectoryAnchor(storage.anchor);
}

function bootstrap(
  storage: CatalogStorage,
  file: LockFile,
  priorControl: Lm2CatalogControl | null,
): Lm2CatalogControl {
  const empty = emptyLm2Catalog();
  const emptySerialized = serializeLm2Catalog(empty);
  if (priorControl !== null) {
    assertBinding(storage, file, priorControl);
    if (priorControl.emptyCatalogDigest !== catalogContentDigest(emptySerialized)) {
      throw new Lm2Error("store_corrupt", "LM2 catalog recovery digest is invalid.");
    }
    createCatalogFile(storage, empty, () => assertBinding(storage, file, priorControl));
    assertBinding(storage, file, priorControl);
    return priorControl;
  }
  assertSafeIdentity(file.stat);
  const token = writeToken(file.descriptor);
  const control: Lm2CatalogControl = {
    schemaVersion: 2,
    catalogLock: { device: file.stat.dev, inode: file.stat.ino, token },
    emptyCatalogDigest: catalogContentDigest(emptySerialized),
  };
  createCatalogControl(storage, control, () => {
    assertNoV1CatalogState(storage);
    const descriptorStat = fstatSync(file.descriptor);
    const namedStat = lstatSync(file.path);
    if (
      !sameFileIdentity(descriptorStat, file.stat) ||
      !sameFileIdentity(namedStat, file.stat) ||
      readToken(file.descriptor) !== token
    ) {
      throw new Lm2Error("store_corrupt", "LM2 catalog lock binding changed.");
    }
  });
  assertBinding(storage, file, control);
  createCatalogFile(storage, empty, () => assertBinding(storage, file, control));
  assertBinding(storage, file, control);
  return control;
}

function releaseAfterFailure(file: LockFile, acquired: boolean): void {
  if (acquired) {
    try {
      flockSync(file.descriptor, "un");
    } catch {
      // The acquisition result is already fail-closed.
    }
  }
  try {
    closeSync(file.descriptor);
  } catch {
    // The acquisition result is already fail-closed.
  }
}

export function acquireCatalogLock(storage: CatalogStorage): CatalogLockGuard {
  const beforeControl = readCatalogControl(storage);
  const beforeCatalog = readStoredCatalog(storage);
  const { file, created } = openLock(storage);
  let acquired = false;
  try {
    if (created && (beforeControl !== null || beforeCatalog !== null)) {
      throw new Lm2Error("store_corrupt", "LM2 catalog lock is missing from durable state.");
    }
    if (beforeControl === null && beforeCatalog !== null) {
      throw new Lm2Error("store_corrupt", "LM2 catalog control is missing.");
    }
    if (beforeControl !== null) assertBinding(storage, file, beforeControl);
    flockSync(file.descriptor, beforeCatalog === null ? "exnb" : "ex");
    acquired = true;
    assertNoV1CatalogState(storage);
    const lockedControl = readCatalogControl(storage);
    const lockedCatalog = readStoredCatalog(storage);
    let control: Lm2CatalogControl;
    if (lockedControl === null && lockedCatalog === null) {
      control = bootstrap(storage, file, null);
    } else if (lockedControl !== null && lockedCatalog === null) {
      control = bootstrap(storage, file, lockedControl);
    } else if (lockedControl !== null && lockedCatalog !== null) {
      assertBinding(storage, file, lockedControl);
      control = lockedControl;
    } else {
      throw new Lm2Error("store_corrupt", "LM2 catalog crash state is unsupported.");
    }
    let released = false;
    return {
      control,
      assertIntact() {
        if (released) throw new Lm2Error("store_corrupt", "LM2 catalog lock was released.");
        assertBinding(storage, file, control);
        const current = readCatalogControl(storage);
        if (current === null || JSON.stringify(current) !== JSON.stringify(control)) {
          throw new Lm2Error("store_corrupt", "LM2 catalog control changed.");
        }
      },
      release() {
        if (released) return;
        released = true;
        let failure: unknown;
        try {
          assertBinding(storage, file, control);
        } catch (error) {
          failure = error;
        }
        try {
          flockSync(file.descriptor, "un");
        } catch (error) {
          failure = combineLm2CleanupFailures(failure, error);
        }
        try {
          closeSync(file.descriptor);
        } catch (error) {
          failure = combineLm2CleanupFailures(failure, error);
        }
        if (failure !== undefined) {
          throw new Lm2Error("store_corrupt", "LM2 catalog lock release failed.", {
            cause: failure,
          });
        }
      },
    };
  } catch (error) {
    releaseAfterFailure(file, acquired);
    if (BUSY_CODES.has(errorCode(error) ?? "")) {
      throw new Lm2Error("write_failed", "LM2 candidate catalog is busy.");
    }
    if (error instanceof Lm2Error) throw error;
    throw new Lm2Error("store_corrupt", "LM2 candidate catalog lock is unavailable.");
  }
}
