import type { ToolWarning } from '../../types.js';
import { defineTool } from '../../lib/define.js';
import { detectDelimiter, parseDelimited, resolveDelimiter } from '../../lib/csv.js';
import { TABLE_SIGNALS, isDelimited, isTable } from '../../lib/table.js';
import { splitLines } from '../../lib/text.js';

/** `obj[key] = v` would hit the prototype setter for a "__proto__" header and drop the column. */
function setOwn(obj: Record<string, string>, key: string, value: string) {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

export const csvToJson = defineTool({
  id: 'csv-to-json',
  title: 'CSV → JSON',
  description: 'Convert CSV/TSV (quoted fields supported) into a JSON array of objects (with header) or arrays.',
  category: 'convert',
  options: {
    type: 'object',
    properties: {
      delimiter: { type: 'string', description: 'auto | tab | comma | pipe | semicolon | literal.', default: 'auto', minLength: 1, maxLength: 10 },
      header: { type: 'boolean', description: 'First row is a header → output objects.', default: true },
      indent: { type: 'integer', description: 'JSON indent (0 = minified).', default: 2, minimum: 0, maximum: 8 },
    },
    additionalProperties: false,
  },
  input: {
    accepts: 'A CSV, TSV or semicolon table, usually with a header row, to turn into JSON (objects keyed by the header, or arrays).',
    signals: { ...TABLE_SIGNALS, delimiter: 'comma, tab or semicolon (pipe and colon lists are not CSV)' },
    avoid: 'Pipe or colon lists such as user|pass → split-columns. Converting JSON back to CSV (not supported).',
    examples: ['name,email,age\nAn,an@x.com,30\nBinh,b@x.com,25', 'id\tcity\n1\tHanoi\n2\tHue'],
  },
  run(input, o) {
    const warnings: ToolWarning[] = [];
    let d = o.delimiter === 'auto' ? detectDelimiter(splitLines(input)) : resolveDelimiter(o.delimiter);
    if (!d) {
      d = ',';
      if (splitLines(input).length > 0) warnings.push({ code: 'DELIMITER_NOT_DETECTED', message: 'Could not detect a delimiter; using comma.' });
    }
    const { rows: rawRows, unterminatedQuoteAt } = parseDelimited(input, d);
    if (unterminatedQuoteAt) warnings.push({ code: 'UNTERMINATED_QUOTE', message: 'Unterminated quote.', line: unterminatedQuoteAt });
    const blankRow = (r: string[]) => r.length === 1 && r[0]!.trim() === '';
    const skipped = o.header ? rawRows.filter(blankRow).length : 0;
    if (skipped) warnings.push({ code: 'BLANK_ROWS_SKIPPED', message: `${skipped} blank row(s) skipped in header mode.` });
    const rows = o.header ? rawRows.filter((r) => !blankRow(r)) : rawRows;

    let data: unknown[];
    if (o.header && rows.length > 0) {
      const header = rows[0]!.map((h, i) => h.trim() || `column${i + 1}`);
      const seen = new Map<string, number>();
      const used = new Set<string>();
      const keys = header.map((h) => {
        let n = seen.get(h) ?? 1;
        let key = h;
        while (used.has(key)) key = `${h}_${++n}`;
        seen.set(h, n);
        used.add(key);
        return key;
      });
      if (keys.some((k, i) => k !== header[i])) warnings.push({ code: 'DUPLICATE_HEADER', message: 'Duplicate header names were suffixed (_2, _3...).' });
      let ragged = 0;
      data = rows.slice(1).map((r) => {
        if (r.length !== keys.length) ragged++;
        const obj: Record<string, string> = {};
        const rowKeys = new Set(keys);
        keys.forEach((k, i) => setOwn(obj, k, r[i] ?? ''));
        for (let i = keys.length; i < r.length; i++) {
          const base = `column${i + 1}`;
          let key = base;
          let n = 1;
          while (rowKeys.has(key)) key = `${base}_${++n}`;
          rowKeys.add(key);
          setOwn(obj, key, r[i]!);
        }
        return obj;
      });
      if (ragged) warnings.push({ code: 'RAGGED_ROWS', message: `${ragged} row(s) have a different column count than the header.` });
    } else {
      data = rows;
    }
    return {
      output: JSON.stringify(data, null, o.indent || undefined),
      data,
      stats: { inputLines: splitLines(input).length, outputLines: data.length, count: data.length },
      warnings,
    };
  },
  suggest: (p) =>
    isDelimited(p) && (p.delimiter === 'comma' || p.delimiter === 'tab' || p.delimiter === 'semicolon')
      ? { score: isTable(p) ? 0.89 : 0.65, reason: 'Tabular data can become JSON', options: { delimiter: p.delimiter } }
      : null,
});
