import type { InputProfile, ToolWarning } from '../types.js';
import { splitLines } from './text.js';
import { detectDelimiter, parseDelimited, resolveDelimiter } from './csv.js';

export const delimiterOpt = {
  type: 'string',
  description: 'Input delimiter: auto | tab | comma | pipe | semicolon | colon | space | any literal string.',
  default: 'auto',
  minLength: 1,
  maxLength: 10,
} as const;

export function resolveInputDelimiter(input: string, name: string, warnings: ToolWarning[]): string {
  if (name !== 'auto') return resolveDelimiter(name);
  const d = detectDelimiter(splitLines(input));
  if (!d) {
    warnings.push({ code: 'DELIMITER_NOT_DETECTED', message: 'Could not detect a delimiter; using comma.' });
    return ',';
  }
  return d;
}

export function readRows(input: string, delimiter: string, warnings: ToolWarning[]): string[][] {
  const { rows, unterminatedQuoteAt } = parseDelimited(input, delimiter);
  if (unterminatedQuoteAt) {
    warnings.push({ code: 'UNTERMINATED_QUOTE', message: 'Unterminated quote; the rest of the input was read as one field.', line: unterminatedQuoteAt });
  }
  return rows.filter((r) => !(r.length === 1 && r[0]!.trim() === ''));
}

/** Widest row. A loop, because `Math.max(...rows)` overflows the call stack on ~100k+ rows. */
export function maxWidth(rows: string[][]): number {
  let w = 0;
  for (const r of rows) if (r.length > w) w = r.length;
  return w;
}

export function raggedWarning(rows: string[][], warnings: ToolWarning[]) {
  const counts = new Set(rows.map((r) => r.length));
  if (counts.size > 1) {
    warnings.push({ code: 'RAGGED_ROWS', message: `Rows have different column counts (${[...counts].sort((a, b) => a - b).join(', ')}).` });
  }
}

/**
 * Profile shows delimited data: ≥ 2 lines with ≥ 2 fields, or one line with ≥ 3 fields.
 * One line split in two ("Hello, world", "From: An") is prose, not data. JSON and JSON Lines are not tables.
 */
export const isDelimited = (p: InputProfile) =>
  !!p.delimiter && !p.jsonValid && !p.jsonLines && p.columnCount >= 2 && (p.nonEmptyLines >= 2 || p.columnCount >= 3);

/** Consistent multi-column table (e.g. user|pass|mail|url): structure beats token extraction. Only call after isDelimited. */
export const isTable = (p: InputProfile) => p.columnCount >= 3 && p.nonEmptyLines >= 2;

/** Signals read by isDelimited + isTable, for the input cards of the column tools. */
export const TABLE_SIGNALS = {
  delimiter: 'not null (the detected separator; passed back as the delimiter option)',
  columnCount: '≥ 2 on ≥ 2 lines, or ≥ 3 on one line; ≥ 3 on ≥ 2 lines is a table (stronger fit)',
  nonEmptyLines: '≥ 2, or 1 when columnCount ≥ 3',
  jsonValid: 'false (JSON goes to json-format)',
  jsonLines: 'false (JSON Lines is not a table)',
} as const;
