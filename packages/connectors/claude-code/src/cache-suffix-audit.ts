import { hookCommandMatches } from "./hook-settings.js";

// Suffix-audit risk vocabulary (2026-08-02 phases 3-4 contract amendment §2).
// The union is closed: no free-text detail may ever join a risk, because a
// detail field is where URLs, commands, secrets, and paths leak into reports.
export const CACHE_SUFFIX_RISK_CODES = [
  "settings_unreadable",
  "settings_malformed",
  "duplicate_megasaver_hook",
  "foreign_custom_base_url",
  "owned_route_missing_first_party_flag",
  "generated_output_byte_variance",
] as const;
export type CacheSuffixRiskCode = (typeof CACHE_SUFFIX_RISK_CODES)[number];

export type CacheSuffixRisk = {
  scope: "configuration-risk";
  code: CacheSuffixRiskCode;
  // Duplicate detection reports which owned pair repeated and how many
  // recognized first-party command objects it saw — never the command text.
  surface?: { event: string; subcommand: string; count: number } | string;
};

export type CacheSuffixAuditOptions = {
  // Mega Saver's known owned forwarding route. Absent disables both URL
  // risks: without the owned route nothing here is actionable, and guessing
  // at foreignness without it would flag the operator's own gateways.
  ownedRouteBaseUrl?: string;
};

const HOOK_EVENTS = ["PreToolUse", "PostToolUse", "UserPromptSubmit", "SessionStart"] as const;

const OWNED_SUBCOMMANDS = ["cache-advice", "guard", "intent", "log", "saver", "warmup"] as const;

const FIRST_PARTY_FLAG = "_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL";

function duplicateHookRisks(settings: Record<string, unknown>): CacheSuffixRisk[] {
  const { hooks } = settings;
  if (typeof hooks !== "object" || hooks === null) return [];
  const risks: CacheSuffixRisk[] = [];
  for (const event of HOOK_EVENTS) {
    const entries = (hooks as Record<string, unknown>)[event];
    if (!Array.isArray(entries)) continue;
    const counts = new Map<string, number>();
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null) continue;
      const commandHooks = (entry as { hooks?: unknown }).hooks;
      if (!Array.isArray(commandHooks)) continue;
      for (const hook of commandHooks) {
        if (typeof hook !== "object" || hook === null) continue;
        const command = (hook as { command?: unknown }).command;
        if (typeof command !== "string") continue;
        for (const subcommand of OWNED_SUBCOMMANDS) {
          if (hookCommandMatches(command, subcommand)) {
            counts.set(subcommand, (counts.get(subcommand) ?? 0) + 1);
            break;
          }
        }
      }
    }
    for (const subcommand of [...counts.keys()].sort()) {
      const count = counts.get(subcommand);
      if (count !== undefined && count > 1) {
        risks.push({
          scope: "configuration-risk",
          code: "duplicate_megasaver_hook",
          surface: { event, subcommand, count },
        });
      }
    }
  }
  return risks;
}

function baseUrlRisks(
  settings: Record<string, unknown>,
  opts: CacheSuffixAuditOptions,
): CacheSuffixRisk[] {
  if (opts.ownedRouteBaseUrl === undefined) return [];
  const { env } = settings;
  if (typeof env !== "object" || env === null) return [];
  const { ANTHROPIC_BASE_URL: baseUrl } = env as Record<string, unknown>;
  if (typeof baseUrl !== "string" || baseUrl.length === 0) return [];
  const risks: CacheSuffixRisk[] = [];
  if (baseUrl !== opts.ownedRouteBaseUrl) {
    risks.push({ scope: "configuration-risk", code: "foreign_custom_base_url" });
  }
  const flag = (env as Record<string, unknown>)[FIRST_PARTY_FLAG];
  if (flag !== "1") {
    risks.push({
      scope: "configuration-risk",
      code: "owned_route_missing_first_party_flag",
    });
  }
  return risks;
}

// Content-free settings inspection. Only owned launchers are normalized
// through the connector matcher; arbitrary strings that resemble mega stay
// foreign and are never reported.
export function auditClaudeCacheSuffix(
  settings: unknown,
  opts: CacheSuffixAuditOptions = {},
): CacheSuffixRisk[] {
  if (typeof settings !== "object" || settings === null) return [];
  const record = settings as Record<string, unknown>;
  return [...duplicateHookRisks(record), ...baseUrlRisks(record, opts)].sort((a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    const aSurface = typeof a.surface === "object" ? a.surface.subcommand : (a.surface ?? "");
    const bSurface = typeof b.surface === "object" ? b.surface.subcommand : (b.surface ?? "");
    return aSurface < bSurface ? -1 : aSurface > bSurface ? 1 : 0;
  });
}

export type ByteVarianceRenderers = {
  hookSettingsRenderer?: () => string;
  connectorBlockRenderer?: () => string;
};

// Same-process determinism probe: render twice, compare UTF-8 bytes. The
// result carries code and surface only — never rendered bytes, digests,
// fixture input, or error text.
export function checkGeneratedOutputByteVariance(
  renderers: ByteVarianceRenderers,
): CacheSuffixRisk[] {
  const risks: CacheSuffixRisk[] = [];
  const probe = (surface: string, render: (() => string) | undefined) => {
    if (render === undefined) return;
    let first: Buffer;
    let second: Buffer;
    try {
      first = Buffer.from(render(), "utf8");
      second = Buffer.from(render(), "utf8");
    } catch {
      return;
    }
    if (!first.equals(second)) {
      risks.push({
        scope: "configuration-risk",
        code: "generated_output_byte_variance",
        surface,
      });
    }
  };
  probe("hook-settings", renderers.hookSettingsRenderer);
  probe("connector-block", renderers.connectorBlockRenderer);
  return risks;
}
