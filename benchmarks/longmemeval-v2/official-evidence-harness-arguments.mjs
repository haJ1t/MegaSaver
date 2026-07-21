import { isDeepStrictEqual } from "node:util";

function fail(message) {
  throw new Error(message);
}

const HARNESS_DEFAULTS = {
  save_memory: false,
  skip_evaluation: false,
  load_memory_dir: null,
  model: null,
  base_url: null,
  api_key_env: "OPENAI_API_KEY",
  api_key_file: null,
  max_completion_tokens: 20_000,
  memory_context_max_tokens: 200_000,
  prompt_build_max_workers: 1,
  shuffle_questions_seed: null,
  reader_max_concurrent_requests: 500,
  timeout_seconds: 43_200,
  reasoning_effort: null,
  temperature: null,
  top_p: null,
  presence_penalty: null,
  top_k: null,
  repetition_penalty: null,
  reader_enable_thinking: true,
  evaluator_model: null,
  evaluator_base_url: null,
  evaluator_api_key_env: "OPENAI_API_KEY",
  evaluator_api_key_file: null,
  evaluator_reasoning_effort: "medium",
  evaluator_max_completion_tokens: 4096,
  evaluator_timeout_seconds: 43_200,
};
const STRING_FLAGS = {
  "--domain": "domain",
  "--questions-path": "questions_path",
  "--haystack-path": "haystack_path",
  "--trajectories-path": "trajectories_path",
  "--memory-config-path": "memory_config_path",
  "--output-dir": "output_dir",
  "--load-memory-dir": "load_memory_dir",
  "--model": "model",
  "--base-url": "base_url",
  "--api-key-env": "api_key_env",
  "--api-key-file": "api_key_file",
  "--reasoning-effort": "reasoning_effort",
  "--evaluator-model": "evaluator_model",
  "--evaluator-base-url": "evaluator_base_url",
  "--evaluator-api-key-env": "evaluator_api_key_env",
  "--evaluator-api-key-file": "evaluator_api_key_file",
  "--evaluator-reasoning-effort": "evaluator_reasoning_effort",
};
const INTEGER_FLAGS = {
  "--max-completion-tokens": "max_completion_tokens",
  "--memory-context-max-tokens": "memory_context_max_tokens",
  "--prompt-build-max-workers": "prompt_build_max_workers",
  "--shuffle-questions-seed": "shuffle_questions_seed",
  "--reader-max-concurrent-requests": "reader_max_concurrent_requests",
  "--top-k": "top_k",
  "--evaluator-max-completion-tokens": "evaluator_max_completion_tokens",
};
const FLOAT_FLAGS = {
  "--timeout-seconds": "timeout_seconds",
  "--temperature": "temperature",
  "--top-p": "top_p",
  "--presence-penalty": "presence_penalty",
  "--repetition-penalty": "repetition_penalty",
  "--evaluator-timeout-seconds": "evaluator_timeout_seconds",
};
const BOOLEAN_FLAGS = {
  "--save-memory": ["save_memory", true],
  "--skip-evaluation": ["skip_evaluation", true],
  "--reader-enable-thinking": ["reader_enable_thinking", true],
  "--reader-disable-thinking": ["reader_enable_thinking", false],
};
const INTEGER_RUN_ARG_KEYS = new Set(Object.values(INTEGER_FLAGS));
const MIN_SAFE_INTEGER = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

function parseInteger(value) {
  const parsed = BigInt(value);
  return parsed >= MIN_SAFE_INTEGER && parsed <= MAX_SAFE_INTEGER ? Number(parsed) : parsed;
}

function parseNumber(value, integer) {
  if (integer && !/^[+-]?[0-9]+$/u.test(value)) {
    fail("Executed harness integer argument is not canonical.");
  }
  if (integer) return parseInteger(value);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    fail("Executed harness numeric argument is invalid.");
  }
  return parsed;
}

export function parseRunArgsJson(source) {
  return JSON.parse(source, (key, value, context) => {
    if (!INTEGER_RUN_ARG_KEYS.has(key) || value === null) return value;
    if (typeof context.source !== "string" || !/^-?(?:0|[1-9][0-9]*)$/u.test(context.source)) {
      fail(`Official run_args integer is not canonical: ${key}`);
    }
    return parseInteger(context.source);
  });
}

export function verifyHarnessArguments(command, arguments_, runArgs) {
  if (
    !isDeepStrictEqual([command, ...arguments_].slice(0, 3), [command, "-m", "evaluation.harness"])
  ) {
    fail("Executed run does not use the pinned official harness module.");
  }
  const parsed = { ...HARNESS_DEFAULTS };
  const seen = new Set();
  for (let index = 2; index < arguments_.length; index += 1) {
    const flag = arguments_[index];
    const boolean = BOOLEAN_FLAGS[flag];
    if (boolean) {
      const [key, value] = boolean;
      if (seen.has(key)) fail(`Executed harness argument is duplicated: ${flag}`);
      seen.add(key);
      parsed[key] = value;
      continue;
    }
    const key = STRING_FLAGS[flag] ?? INTEGER_FLAGS[flag] ?? FLOAT_FLAGS[flag];
    const value = arguments_[index + 1];
    if (!key || value === undefined || value.startsWith("--") || seen.has(key)) {
      fail(`Executed harness argument is not canonical: ${flag}`);
    }
    seen.add(key);
    parsed[key] = Object.hasOwn(INTEGER_FLAGS, flag)
      ? parseNumber(value, true)
      : Object.hasOwn(FLOAT_FLAGS, flag)
        ? parseNumber(value, false)
        : value;
    index += 1;
  }
  for (const key of [
    "domain",
    "questions_path",
    "haystack_path",
    "trajectories_path",
    "output_dir",
  ])
    if (!seen.has(key)) fail(`Required official harness argument is missing: ${key}`);
  const choices = {
    domain: ["web", "enterprise"],
    reasoning_effort: [null, "low", "medium", "high"],
    evaluator_reasoning_effort: ["low", "medium", "high"],
  };
  for (const [key, allowed] of Object.entries(choices))
    if (!allowed.includes(parsed[key])) fail(`Official harness choice is invalid: ${key}`);
  if (Number.isNaN(Date.parse(runArgs.started_at_utc))) fail("Official run timestamp is invalid.");
  if (!isDeepStrictEqual(runArgs, { ...parsed, started_at_utc: runArgs.started_at_utc })) {
    fail("run_args.json differs from the complete official harness arguments.");
  }
}
