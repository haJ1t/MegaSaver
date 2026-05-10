import { tokenSaverModeSchema } from "@megasaver/shared";
import { z } from "zod";

// Per-session token-saver settings. The mode enum + budget map live in
// `@megasaver/shared` (AA1 §2e). This object is the user-toggleable
// state that ContextGate (BB7a) and the GUI panel (BB10) read and the
// `mega session saver` CLI (BB2) writes via CoreRegistry.updateTokenSaver.
// Strict: unknown keys are rejected so a future schema widening can
// only happen by editing this file (AA1 §4a).
export const tokenSaverSettingsSchema = z
  .object({
    enabled: z.boolean(),
    mode: tokenSaverModeSchema,
    maxReturnedBytes: z.number().int().positive(),
    storeRawOutput: z.boolean(),
    redactSecrets: z.boolean(),
    autoRepair: z.boolean(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type TokenSaverSettings = z.infer<typeof tokenSaverSettingsSchema>;

// `now` is injected (not Date.now() at module level) per CLAUDE.md §8
// boundary rule and matches the BridgeHandlerOptions.now pattern at
// apps/gui/bridge/handler.ts. Default mode is "balanced" (12_000 byte
// budget) per AA1 §4a — the safe-by-default middle setting.
export function defaultTokenSaverSettings(now: () => string): TokenSaverSettings {
  const stamp = now();
  return {
    enabled: false,
    mode: "balanced",
    maxReturnedBytes: 12_000,
    storeRawOutput: true,
    redactSecrets: true,
    autoRepair: true,
    createdAt: stamp,
    updatedAt: stamp,
  };
}
