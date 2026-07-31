/**
 * @scaffold UNVALIDATED EXPERIMENTAL SAB GRAMMAR V0
 * WARNING: Parity validation requires the Phase 4 eval harness (sab-eval-harness).
 * DO NOT treat parityValidated as true without benchmark execution proof.
 */
export interface SABGrammarRule {
  symbolName: string;
  language: string;
  tokenizerTarget: string;
  parityValidated: boolean;
}

export function parseSABGrammarV0(
  symbolName: string,
  language: string,
  tokenizerTarget: string,
): SABGrammarRule {
  // @scaffold: Parity is NOT validated until benchmark eval harness runs.
  return {
    symbolName,
    language,
    tokenizerTarget,
    parityValidated: false,
  };
}
