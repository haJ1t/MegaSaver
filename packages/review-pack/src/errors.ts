import { z } from "zod";

export const reviewPackErrorCodeSchema = z.enum([
  "bad_range",
  "dirty_worktree",
  "empty_diff",
  "git_unavailable",
  "store_write_failed",
]);

export type ReviewPackErrorCode = z.infer<typeof reviewPackErrorCodeSchema>;

export class ReviewPackError extends Error {
  readonly code: ReviewPackErrorCode;

  constructor(code: ReviewPackErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ReviewPackError";
    this.code = code;
  }
}
