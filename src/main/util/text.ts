import { MAX_TEXT_CHUNK } from "@shared/types";

/**
 * Split text into chunks of at most `size` Unicode code points. Uses the string
 * iterator so surrogate pairs (emoji) and combining sequences are never split
 * across two SSAP requests.
 */
export function chunkText(text: string, size: number = MAX_TEXT_CHUNK): string[] {
  if (size <= 0) throw new RangeError("chunk size must be positive");
  if (text.length === 0) return [];

  const chunks: string[] = [];
  let current = "";
  let count = 0;

  for (const codePoint of text) {
    current += codePoint;
    count += 1;
    if (count === size) {
      chunks.push(current);
      current = "";
      count = 0;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Number of Unicode code points (not UTF-16 units) in a string. */
export function codePointLength(text: string): number {
  let n = 0;
  for (const _ of text) n += 1;
  return n;
}
