import { encode } from 'gpt-tokenizer';

export function countTokens(text) {
  if (!text) return 0;
  try {
    return encode(text).length;
  } catch (_) {
    // Fallback: rough 4-chars-per-token estimate
    return Math.ceil(text.length / 4);
  }
}
