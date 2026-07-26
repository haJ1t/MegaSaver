import { constants, fsyncSync } from "node:fs";
import { Lm2Error } from "./lm2-errors.js";
import type { DirectoryAnchor } from "./lm2-secure-fs.js";

export function secureOpenFlags(
  flags: number,
  platform: NodeJS.Platform = process.platform,
): number {
  return platform === "win32" ? flags : flags | constants.O_NOFOLLOW;
}

export function secureDirectoryOpenFlags(platform: NodeJS.Platform = process.platform): number {
  return secureOpenFlags(
    constants.O_RDONLY | (platform === "win32" ? 0 : constants.O_DIRECTORY),
    platform,
  );
}

export function syncDirectoryAnchor(
  anchor: DirectoryAnchor,
  platform: NodeJS.Platform = process.platform,
): void {
  const descriptor = anchor.chain.at(-1)?.descriptor;
  if (descriptor === undefined)
    throw new Lm2Error("store_corrupt", "LM2 directory anchor is empty.");
  syncDirectoryDescriptor(descriptor, platform);
}

export function syncDirectoryDescriptor(
  descriptor: number,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === "win32") return;
  fsyncSync(descriptor);
}
