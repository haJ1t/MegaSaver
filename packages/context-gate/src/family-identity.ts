import { createHash } from "node:crypto";
import { type RepositoryFamilyKey, repositoryFamilyKeySchema } from "@megasaver/shared";

// Injected so tests never touch the real disk and can simulate APFS/NTFS/ext4.
export type CaseMode = "sensitive" | "insensitive" | "unknown";
export type FamilyFsAdapter = {
  realpathNative(p: string): string;
  caseMode(p: string): CaseMode;
};

export type CanonicalFamilyPath = {
  canonicalPath: string;
  caseMode: CaseMode;
  diagnostic: "case_mode_unknown" | null;
};

// realpath.native → NFC → forward slashes → lowercase ONLY on a positively
// established case-insensitive volume. Platform name never decides casing; the
// adapter's volume metadata does. `unknown` preserves casing and is surfaced so
// a false-negative alias split is visible rather than a wrong conflation.
export function canonicalFamilyPath(
  path: string,
  _platform: NodeJS.Platform | string,
  fs: FamilyFsAdapter,
): CanonicalFamilyPath {
  const real = fs.realpathNative(path).normalize("NFC").replaceAll("\\", "/");
  const caseMode = fs.caseMode(real);
  const canonicalPath = caseMode === "insensitive" ? real.toLowerCase() : real;
  return {
    canonicalPath,
    caseMode,
    diagnostic: caseMode === "unknown" ? "case_mode_unknown" : null,
  };
}

export type FamilyKey = {
  key: RepositoryFamilyKey;
  digestHex: string;
  identityPath: string;
};

// Domain-separated SHA-256 of the canonical common-directory path. The token
// binds platform + caseMode so a path can never collide across volume-semantics
// domains. base64url(no padding) → gf1_ prefix for the key; hex of the same 32
// bytes for the record's identityDigest.
export function familyKeyFromPath(
  platform: NodeJS.Platform | string,
  caseMode: CaseMode,
  canonicalPath: string,
): FamilyKey {
  const token = `git-family:v1:path:${platform}:${caseMode}:${canonicalPath}`;
  const digest = createHash("sha256").update(token, "utf8").digest();
  const key = repositoryFamilyKeySchema.parse(`gf1_${digest.toString("base64url")}`);
  return { key, digestHex: digest.toString("hex"), identityPath: canonicalPath };
}
