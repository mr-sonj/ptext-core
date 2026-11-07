/** Split text into lines, accepting \r\n, \n and \r. A single trailing newline does not create an extra empty line. */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function countLines(text: string): number {
  return splitLines(text).length;
}

/** Keep first occurrence order. `keyFn` decides equality. */
export function unique<T>(items: T[], keyFn: (item: T) => string = (x) => String(x)): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = keyFn(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

/** Zero-width & BOM characters that silently break comparisons. */
export const INVISIBLE_RE = /[\u200B-\u200D\u2060\uFEFF]/g;

/** Trailing punctuation that is usually not part of an extracted token. */
export function trimTrailingPunctuation(s: string): string {
  return s.replace(/[.,;:!?'"]+$/u, '');
}
