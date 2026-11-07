import { findIps } from './match.js';

export interface ParseResult {
  rows: string[][];
  /** 1-based line numbers where an unterminated quote was found. */
  unterminatedQuoteAt?: number;
}

/** Parse delimited text with RFC 4180 quoting ("" escapes, quoted newlines). */
export function parseDelimited(text: string, delimiter: string): ParseResult {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let quoteStartLine = 0;
  let line = 1;
  let i = 0;
  const n = text.length;
  const dl = delimiter.length;

  while (i < n) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      if (ch === '\n') line++;
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
      quoteStartLine = line;
      i++;
      continue;
    }
    if (text.startsWith(delimiter, i)) {
      row.push(field);
      field = '';
      i += dl;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (ch === '\r' && text[i + 1] === '\n') i++;
      i++;
      line++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const res: ParseResult = { rows };
  if (inQuotes) res.unterminatedQuoteAt = quoteStartLine;
  return res;
}

export function escapeCsvField(value: string, delimiter = ','): string {
  if (value.includes('"') || value.includes(delimiter) || /[\r\n]/.test(value) || /^\s|\s$/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(rows: string[][], delimiter = ','): string {
  return rows.map((r) => r.map((f) => escapeCsvField(f, delimiter)).join(delimiter)).join('\n');
}

const DELIMITER_CANDIDATES = ['\t', '|', ',', ';', ':'] as const;

/**
 * Tokens that hold a candidate character but never separate fields: clock times (10:00, 10:00:01,
 * log4j 10:00:01,123), URL schemes (https://), HTML entities (&amp; &#39;) and Windows drives (C:\).
 * ip:port, user:pass and "key: value" are left alone, so they still split on the colon.
 */
const NOT_A_SEPARATOR = /(?<![\d:])\d{1,2}:\d{2}(?::\d{2}(?:,\d{3}(?=\s|$))?)?(?![\d:])|\b[a-z][a-z0-9+.-]*:\/\/|&(?:[a-z][a-z0-9]{1,31}|#\d{1,7}|#x[0-9a-f]{1,6});|(?<![a-z0-9])[a-z]:\\/gi;

function maskNonSeparators(line: string): string {
  let s = line;
  // IPv6 first: masking a time-like "10:30" inside an address would make it invalid.
  if (s.includes('::') || /(?:[0-9a-f]{1,4}:){7}/i.test(s)) {
    const ips = findIps(s, '6', false);
    for (let i = ips.length - 1; i >= 0; i--) s = s.slice(0, ips[i]!.index) + '_' + s.slice(ips[i]!.index + ips[i]!.length);
  }
  return s.replace(NOT_A_SEPARATOR, '_');
}

/** Guess the delimiter by consistency of field count across the first lines. */
export function detectDelimiter(lines: string[]): string | null {
  const sample = lines
    .filter((l) => l.trim() !== '')
    .slice(0, 50)
    .map(maskNonSeparators);
  if (sample.length === 0) return null;
  let best: { d: string; score: number } | null = null;
  for (const d of DELIMITER_CANDIDATES) {
    const counts = sample.map((l) => l.split(d).length - 1);
    const withD = counts.filter((c) => c > 0);
    if (withD.length < Math.ceil(sample.length * 0.8)) continue;
    const mode = mostCommon(withD);
    const consistent = counts.filter((c) => c === mode).length / sample.length;
    const score = consistent * 10 + Math.min(mode, 10) * 0.1;
    if (!best || score > best.score) best = { d, score };
  }
  return best?.d ?? null;
}

function mostCommon(nums: number[]): number {
  const m = new Map<number, number>();
  for (const x of nums) m.set(x, (m.get(x) ?? 0) + 1);
  let best = nums[0]!;
  let bestC = 0;
  for (const [k, c] of m) if (c > bestC) [best, bestC] = [k, c];
  return best;
}

export const DELIMITER_NAMES: Record<string, string> = {
  tab: '\t',
  comma: ',',
  pipe: '|',
  semicolon: ';',
  colon: ':',
  space: ' ',
};

export function resolveDelimiter(name: string): string {
  return DELIMITER_NAMES[name] ?? name;
}
