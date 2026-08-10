// Instant Tool Failure Airlock & Automated Negative Rule Synthesizer
import { randomUUID } from "node:crypto";

export interface AirlockNegativeRule {
  ruleId: string;
  sessionId: string;
  toolName: string;
  forbiddenPattern: string;
  reason: string;
  createdAt: string;
  ttlSeconds: number;
}

export interface SynthesizeMistakeInput {
  sessionId: string;
  toolName: string;
  rawCommand: string;
  exitCode: number;
  stderr: string;
  ttlSeconds?: number;
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const UNRECOGNIZED_OPTION_PATTERNS = [
  /unexpected argument '([^']+)'/i,
  /unrecognized option '([^']+)'/i,
  /unknown option `([^']+)'/i,
  /invalid option -- '([^']+)'/i,
  /unknown flag: ([^\s]+)/i,
];

export function synthesizeMistakeRule(input: SynthesizeMistakeInput): AirlockNegativeRule | null {
  if (input.exitCode === 0 && !input.stderr) {
    return null;
  }

  let extractedFlag: string | null = null;
  for (const pattern of UNRECOGNIZED_OPTION_PATTERNS) {
    const match = input.stderr.match(pattern);
    if (match?.[1]) {
      extractedFlag = match[1];
      break;
    }
  }

  if (!extractedFlag) {
    return null;
  }

  const cleanFlag = extractedFlag.startsWith("-") ? extractedFlag : `--${extractedFlag}`;

  const escapedTool = escapeRegExp(input.toolName);
  const escapedFlag = escapeRegExp(cleanFlag);

  return {
    ruleId: `airlock-${randomUUID()}`,
    sessionId: input.sessionId,
    toolName: input.toolName,
    forbiddenPattern: `^${escapedTool}(?:\\s+.*)?${escapedFlag}(?:\\b|$)`,
    reason: input.stderr.trim().split("\n")[0] || `Tool call failed with flag ${cleanFlag}`,
    createdAt: new Date().toISOString(),
    ttlSeconds: input.ttlSeconds ?? 3600,
  };
}
