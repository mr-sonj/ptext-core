import { PTextError, type ToolWarning } from '../../types.js';
import { defineTool } from '../../lib/define.js';
import { resolveDelimiter, toCsv } from '../../lib/csv.js';
import { TABLE_SIGNALS, delimiterOpt, isDelimited, isTable, maxWidth, readRows, resolveInputDelimiter } from '../../lib/table.js';
import { splitLines } from '../../lib/text.js';

/** 0-based column refs; a negative ref counts from the end of each row (-1 = last cell). */
function parseColumnSpec(spec: string, width: number, warnings: ToolWarning[]): number[] {
  const cols: number[] = [];
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (a < 1 || b < 1) throw new PTextError('INVALID_OPTION', 'Column numbers start at 1', { option: 'columns' });
      // Never expand past the widest row: "2-999999" means "2 to last", and expanding it as written allocates millions of cells.
      const lo = Math.min(a, b);
      const hi = Math.min(Math.max(a, b), Math.max(width, lo));
      if (hi < Math.max(a, b)) {
        const clamped = a <= b ? `${lo}-${hi}` : `${hi}-${lo}`;
        warnings.push({ code: 'RANGE_CLAMPED', message: `Range "${part}" exceeds the widest row (${width} columns); used ${clamped}.` });
      }
      if (a <= b) for (let i = lo; i <= hi; i++) cols.push(i - 1);
      else for (let i = hi; i >= lo; i--) cols.push(i - 1);
      continue;
    }
    if (/^-?\d+$/.test(part)) {
      const n = Number(part);
      if (n === 0) throw new PTextError('INVALID_OPTION', 'Column numbers start at 1', { option: 'columns' });
      cols.push(n > 0 ? n - 1 : n);
      continue;
    }
    throw new PTextError('INVALID_OPTION', `Invalid column spec "${part}". Use e.g. "1,3" or "2-4" or "-1".`, { option: 'columns' });
  }
  if (cols.length === 0) throw new PTextError('INVALID_OPTION', 'No columns selected', { option: 'columns' });
  return cols;
}

export const selectColumns = defineTool({
  id: 'select-columns',
  title: 'Select / reorder columns',
  description: 'Pick and reorder columns by 1-based index ("3,1", "2-4", "-1" = last cell of each row) from delimited text.',
  category: 'columns',
  options: {
    type: 'object',
    properties: {
      columns: { type: 'string', description: 'Columns to keep in order, e.g. "3,1" or "1-2,5" or "-1" (last cell of each row). Ranges stop at the widest row ("2-99" = 2 to last).', maxLength: 200 },
      delimiter: delimiterOpt,
      outputDelimiter: { type: 'string', description: 'Output delimiter; "same" keeps the input delimiter.', default: 'same', maxLength: 10 },
      skipHeader: { type: 'boolean', description: 'Drop the first row.', default: false },
    },
    required: ['columns'],
    additionalProperties: false,
  },
  input: {
    accepts: 'Delimited lines (pipe, tab, comma, semicolon, colon) when only some columns are wanted or their order must change, e.g. the 3rd column of user|pass|mail. The user gives the columns.',
    signals: TABLE_SIGNALS,
    avoid: 'Every column, just split → split-columns. Emails scattered in free text, not in a column → extract-emails.',
    examples: ['user|pass|mail\nu1|p1|m1\nu2|p2|m2'],
  },
  run(input, o) {
    const warnings: ToolWarning[] = [];
    const d = resolveInputDelimiter(input, o.delimiter, warnings);
    let rows = readRows(input, d, warnings);
    if (o.skipHeader) rows = rows.slice(1);
    const cols = parseColumnSpec(o.columns, maxWidth(rows), warnings);
    let missing = 0;
    const picked = rows.map((r) =>
      cols.map((c) => {
        const i = c >= 0 ? c : r.length + c;
        const v = i >= 0 ? r[i] : undefined;
        if (v === undefined) missing++;
        return v ?? '';
      }),
    );
    if (missing > 0) warnings.push({ code: 'MISSING_CELLS', message: `${missing} selected cell(s) did not exist and were left empty.` });
    const outD = o.outputDelimiter === 'same' ? d : resolveDelimiter(o.outputDelimiter);
    return {
      output: toCsv(picked, outD),
      data: picked,
      stats: { inputLines: splitLines(input).length, outputLines: picked.length, count: cols.length },
      warnings,
    };
  },
  suggest: (p) =>
    isDelimited(p) ? { score: isTable(p) ? 0.88 : 0.6, reason: 'Pick specific columns', options: { delimiter: p.delimiter } } : null,
});
