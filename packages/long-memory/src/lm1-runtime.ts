import { isAbsolute } from "node:path";
import { type Lm1CaptureService, type Lm1Clock, createLm1CaptureService } from "./lm1-capture.js";
import { Lm1Error } from "./lm1-errors.js";
import type { EvidenceBindingPort, EvidenceEligibilityPort, RedactionPort } from "./lm1-model.js";
import { type Lm1RecallService, createLm1RecallService } from "./lm1-recall.js";
import { createFileLm1Store } from "./lm1-store.js";

export type Lm1Runtime = {
  capture: Lm1CaptureService;
  recall: Lm1RecallService;
};

type Lm1RuntimeInput = {
  storeRoot: string;
  redaction: RedactionPort;
  evidenceBinding: EvidenceBindingPort;
  evidenceEligibility: EvidenceEligibilityPort;
  clock: Lm1Clock;
};

function parseRuntimeInput(input: unknown): Lm1RuntimeInput {
  try {
    if (input === null || typeof input !== "object") {
      throw new Error("Invalid LM1 runtime input.");
    }
    const { storeRoot, redaction, evidenceBinding, evidenceEligibility, clock } = input as {
      storeRoot: unknown;
      redaction: unknown;
      evidenceBinding: unknown;
      evidenceEligibility: unknown;
      clock: unknown;
    };
    if (
      typeof storeRoot !== "string" ||
      !isAbsolute(storeRoot) ||
      redaction === null ||
      typeof redaction !== "object" ||
      evidenceBinding === null ||
      typeof evidenceBinding !== "object" ||
      evidenceEligibility === null ||
      typeof evidenceEligibility !== "object" ||
      clock === null ||
      typeof clock !== "object"
    ) {
      throw new Error("Invalid LM1 runtime input.");
    }
    return {
      storeRoot,
      redaction: redaction as RedactionPort,
      evidenceBinding: evidenceBinding as EvidenceBindingPort,
      evidenceEligibility: evidenceEligibility as EvidenceEligibilityPort,
      clock: clock as Lm1Clock,
    };
  } catch {
    throw new Lm1Error("invalid_input", "Invalid LM1 runtime input.");
  }
}

export function createLm1Runtime(input: Lm1RuntimeInput): Lm1Runtime {
  const parsedInput = parseRuntimeInput(input);
  const store = createFileLm1Store({ storeRoot: parsedInput.storeRoot });
  return {
    capture: createLm1CaptureService({
      store,
      redaction: parsedInput.redaction,
      evidenceBinding: parsedInput.evidenceBinding,
      evidenceEligibility: parsedInput.evidenceEligibility,
      clock: parsedInput.clock,
    }),
    recall: createLm1RecallService({ store, evidenceEligibility: parsedInput.evidenceEligibility }),
  };
}
