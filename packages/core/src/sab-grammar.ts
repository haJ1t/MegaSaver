export interface SABGrammarRule {
  symbolName: string;
  language: string;
  tokenizerTarget: string;
  parityValidated: boolean;
}

export function parseSABGrammarV0(
  symbolName: string,
  language: string,
  tokenizerTarget: string
): SABGrammarRule {
  return {
    symbolName,
    language,
    tokenizerTarget,
    parityValidated: true,
  };
}
