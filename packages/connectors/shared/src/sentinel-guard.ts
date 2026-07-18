import {
  MEGA_SAVER_BLOCK_END,
  MEGA_SAVER_BLOCK_START,
  MEGA_SAVER_CG_BLOCK_END,
  MEGA_SAVER_CG_BLOCK_START,
  MEGA_SAVER_HANDOFF_BLOCK_END,
  MEGA_SAVER_HANDOFF_BLOCK_START,
  MEGA_SAVER_WS_BLOCK_END,
  MEGA_SAVER_WS_BLOCK_START,
} from "./constants.js";

const ALL_SENTINELS = [
  MEGA_SAVER_BLOCK_START,
  MEGA_SAVER_BLOCK_END,
  MEGA_SAVER_CG_BLOCK_START,
  MEGA_SAVER_CG_BLOCK_END,
  MEGA_SAVER_WS_BLOCK_START,
  MEGA_SAVER_WS_BLOCK_END,
  MEGA_SAVER_HANDOFF_BLOCK_START,
  MEGA_SAVER_HANDOFF_BLOCK_END,
] as const;

// Strip zero-width, bidi-control, and BOM characters before NFKC-normalising,
// so visually-identical sentinel lookalikes are rejected the same as exact matches.
const SENTINEL_INVISIBLE_CHARS = /[​-‏‪-‮⁠-⁤﻿]/g;

const normalizeForSentinelCheck = (value: string): string =>
  value.replace(SENTINEL_INVISIBLE_CHARS, "").normalize("NFKC");

export const containsSentinel = (value: string): boolean => {
  const normalized = normalizeForSentinelCheck(value);
  return ALL_SENTINELS.some((sentinel) => normalized.includes(sentinel));
};
