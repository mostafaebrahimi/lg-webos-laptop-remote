/** Helpers for mirroring a local text field into a focused webOS text widget. */

export const codePointLength = (value: string): number => [...value].length;

/** Length of the common prefix of two strings, counted in code points. */
export function commonPrefixLength(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1;
  return index;
}

/**
 * The minimal delete-then-insert pair that turns `sent` into `next` on the TV.
 * webOS only offers "delete previous characters" and "insert at cursor", so an
 * edit in the middle becomes: delete back to the divergence point, then insert
 * the rest. The resulting string is always correct.
 */
export function diffForTv(sent: string, next: string): { deletions: number; insertion: string } {
  const prefix = commonPrefixLength(sent, next);
  return {
    deletions: codePointLength(sent) - prefix,
    insertion: [...next].slice(prefix).join(""),
  };
}
