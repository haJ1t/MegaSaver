// Ambient types for the JS pack helper so the test type-checks. The runtime
// logic lives in strip-publish-manifest.mjs; this only declares the surface the
// test consumes.
export const MANIFEST_FILE: string;
export const BACKUP_FILE: string;
export function stripManifest<T extends Record<string, unknown>>(
  manifest: T,
): Omit<T, "devDependencies">;
export function runPrepack(dir?: string): void;
export function runPostpack(dir?: string): void;
