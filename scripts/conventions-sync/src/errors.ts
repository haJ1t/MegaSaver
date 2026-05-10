export type ConventionsErrorCode =
  | "block-unclosed"
  | "block-orphan-end"
  | "block-duplicate-id"
  | "block-nested"
  | "block-malformed"
  | "source-missing"
  | "source-fragment-missing"
  | "mode-conflict"
  | "consumer-missing";

export class ConventionsError extends Error {
  readonly code: ConventionsErrorCode;
  readonly detail: string;

  constructor(code: ConventionsErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.code = code;
    this.detail = detail;
    this.name = "ConventionsError";
  }
}
