import type { OutputSourceKind } from "@megasaver/output-filter";
import type { TokenSaverEvent } from "./event.js";

// Proxy Mode v1.2 §7.2 / D7. Adoption is universal and always available;
// hook-based interception is shown ONLY when a Claude Code hook log exists.
// Every recorded TokenSaverEvent is a MegaSaver-mediated, proxy-eligible
// call (it came through a proxy_* / mega_* tool), so the events JSONL IS
// the adoption audit trail. Native Read/Bash/Grep that bypass MegaSaver are
// invisible here — they only ever appear in the optional hook log.

export type ProxyToolName =
  | "proxy_read_file"
  | "proxy_run_command"
  | "proxy_search_code"
  | "proxy_expand_chunk";

// §3 / §5.3 mapping: output source kind (recorded on each event) -> the
// public proxy tool that produced it.
const SOURCE_KIND_TO_PROXY: Record<OutputSourceKind, ProxyToolName> = {
  file: "proxy_read_file",
  command: "proxy_run_command",
  grep: "proxy_search_code",
  fetch: "proxy_expand_chunk",
};

export function proxyToolNameForSourceKind(kind: OutputSourceKind): ProxyToolName {
  return SOURCE_KIND_TO_PROXY[kind];
}

export type AdoptionMetrics = {
  proxy_adoption_rate: number;
  proxy_call_count: number;
  proxy_calls_by_type: Record<ProxyToolName, number>;
  expand_rate: number;
  proxy_mediated_token_savings: number;
  raw_stored_output_count: number;
  avg_compression_ratio: number;
};

function emptyByType(): Record<ProxyToolName, number> {
  return {
    proxy_read_file: 0,
    proxy_run_command: 0,
    proxy_search_code: 0,
    proxy_expand_chunk: 0,
  };
}

export function aggregateAdoption(events: readonly TokenSaverEvent[]): AdoptionMetrics {
  const byType = emptyByType();
  let savings = 0;
  let ratioSum = 0;
  for (const event of events) {
    byType[proxyToolNameForSourceKind(event.sourceKind)] += 1;
    savings += event.bytesSaved;
    ratioSum += event.savingRatio;
  }
  const knownMegasaverCalls = events.length;
  // Every recorded event is a proxy_* call (§ denominator contract): the
  // subset of known_megasaver_tool_calls whose tool is a proxy_* tool is the
  // whole set. proxy_adoption_rate = proxy / known; zero-denominator -> 0.0.
  const proxyCalls = knownMegasaverCalls;
  // Compressed responses are the non-expand calls; expand_rate is the share
  // of those that were drilled into via proxy_expand_chunk.
  const compressedResponses = knownMegasaverCalls - byType.proxy_expand_chunk;
  return {
    proxy_adoption_rate: knownMegasaverCalls === 0 ? 0 : proxyCalls / knownMegasaverCalls,
    proxy_call_count: proxyCalls,
    proxy_calls_by_type: byType,
    expand_rate: compressedResponses === 0 ? 0 : byType.proxy_expand_chunk / compressedResponses,
    proxy_mediated_token_savings: savings,
    raw_stored_output_count: knownMegasaverCalls,
    avg_compression_ratio: knownMegasaverCalls === 0 ? 0 : ratioSum / knownMegasaverCalls,
  };
}

// §13.3: the five native tools whose calls the PreToolUse hook records.
// Eligibility is keyed on the tool name, never on the (opaque) category tag.
const ELIGIBLE_NATIVE_TOOLS = new Set(["Read", "Bash", "Grep", "Glob", "LS"]);

export type HookIngestResult = { nativeEligibleCount: number };

export function ingestHookLog(content: string): HookIngestResult {
  let count = 0;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let record: unknown;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (
      typeof record === "object" &&
      record !== null &&
      "tool" in record &&
      typeof (record as { tool: unknown }).tool === "string" &&
      ELIGIBLE_NATIVE_TOOLS.has((record as { tool: string }).tool)
    ) {
      count += 1;
    }
  }
  return { nativeEligibleCount: count };
}

export type InterceptionMetrics = {
  hook_present: true;
  proxy_eligible_calls: number;
  native_eligible_calls_from_hook: number;
  hook_interception_rate: number;
};

export function computeInterception(
  proxyEligible: number,
  nativeEligible: number,
): InterceptionMetrics {
  const denominator = proxyEligible + nativeEligible;
  return {
    hook_present: true,
    proxy_eligible_calls: proxyEligible,
    native_eligible_calls_from_hook: nativeEligible,
    hook_interception_rate: denominator === 0 ? 0 : proxyEligible / denominator,
  };
}

// Verbatim spec §13.6 missing-hook copy. Honest-metrics discipline: when no
// hook log exists, never imply a universal interception rate — show adoption
// only plus this install suggestion.
export const HOOK_MISSING_HINT =
  "Proxy adoption metrics only. Claude Code hook telemetry not configured. Run: mega hooks install claude-code";

export type ProxyMetrics = {
  adoption: AdoptionMetrics;
  interception: InterceptionMetrics | null;
  interception_hint: string;
};

export type BuildProxyMetricsInput = {
  events: readonly TokenSaverEvent[];
  hookLog: string | null;
};

export function buildProxyMetrics(input: BuildProxyMetricsInput): ProxyMetrics {
  const adoption = aggregateAdoption(input.events);
  if (input.hookLog === null) {
    return { adoption, interception: null, interception_hint: HOOK_MISSING_HINT };
  }
  const native = ingestHookLog(input.hookLog).nativeEligibleCount;
  return {
    adoption,
    interception: computeInterception(adoption.proxy_call_count, native),
    interception_hint: HOOK_MISSING_HINT,
  };
}
