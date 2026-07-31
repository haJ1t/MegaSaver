import { describe, it, expect } from 'vitest';
import { parseSABGrammarV0 } from '../src/sab-grammar.js';

describe('sab-grammar', () => {
  it('parses SAB grammar v0 and validates language-tokenizer parity matrix', () => {
    const rule = parseSABGrammarV0('function_signature', 'typescript', 'cl100k_base');
    expect(rule.symbolName).toBe('function_signature');
    expect(rule.language).toBe('typescript');
    expect(rule.parityValidated).toBe(true);
  });
});
