import type { ToolWarning } from '../../types.js';
import { defineTool } from '../../lib/define.js';
import { resolveDelimiter, toCsv } from '../../lib/csv.js';
import { TABLE_SIGNALS, delimiterOpt, isDelimited, isTable, maxWidth, raggedWarning, readRows, resolveInputDelimiter } from '../../lib/table.js';
import { splitLines } from '../../lib/text.js';

export const splitColumns = defineTool({
  id: 'split-columns',
  title: 'Split into columns',
  description: 'Split delimited lines (e.g. user|pass|mail, tab-separated, quoted CSV) into columns and output CSV.',
  category: 'columns',
  options: {
    type: 'object',
    properties: {
      delimiter: delimiterOpt,
      outputDelimiter: { type: 'string', description: 'Output delimiter name or literal.', default: 'comma', maxLength: 10 },
    },
    additionalProperties: false,
  },
  input: {
    accepts: 'Delimited lines to turn into clean CSV columns: user|pass|mail dumps, user:pass or ip:port lists, tab-separated pastes from a spreadsheet, quoted CSV, key: value lines.',
    signals: TABLE_SIGNALS,
    avoid: 'Only some columns are wanted, or in another order → select-columns. JSON objects are wanted → csv-to-json.',
    examples: ['user1|pass1|a@x.com\nuser2|pass2|b@x.com', 'user1:pass1\nuser2:pass2'],
  },
  run(input, o) {
    const warnings: ToolWarning[] = [];
    const d = resolveInputDelimiter(input, o.delimiter, warnings);
    const rows = readRows(input, d, warnings);
    raggedWarning(rows, warnings);
    const out = toCsv(rows, resolveDelimiter(o.outputDelimiter));
    return {
      output: out,
      data: rows,
      stats: { inputLines: splitLines(input).length, outputLines: rows.length, count: maxWidth(rows) },
      warnings,
    };
  },
  suggest: (p) =>
    isDelimited(p)
      ? { score: isTable(p) ? 0.92 : 0.8, reason: `${p.columnCount} columns separated by ${p.delimiter}`, options: { delimiter: p.delimiter } }
      : null,
});
