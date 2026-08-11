import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const megaConfigSchema = z
  .object({
    core: z.enum(["daemon", "on-demand"]).optional(),
  })
  .strict()
  .catchall(z.unknown());

export type MegaConfig = z.infer<typeof megaConfigSchema>;

export function readMegaConfig(cwd: string, home: string): MegaConfig {
  const candidates = [join(cwd, "mega.config.json"), join(home, ".megasaver", "config.json")];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const raw = JSON.parse(readFileSync(path, "utf8"));
      const parsed = megaConfigSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
    } catch {
      // ignore malformed, continue
    }
  }
  return {};
}

export function resolveCoreMode(input: {
  flagOnDemand?: boolean;
  flagDaemon?: boolean;
  config?: MegaConfig;
}): "daemon" | "on-demand" {
  if (input.flagOnDemand) return "on-demand";
  if (input.flagDaemon) return "daemon";
  if (input.config?.core) return input.config.core;
  return "daemon";
}
