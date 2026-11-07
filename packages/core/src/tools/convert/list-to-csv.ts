import { defineTool } from '../../lib/define.js';
import { resolveDelimiter, toCsv } from '../../lib/csv.js';
import { splitLines } from '../../lib/text.js';

export const listToCsv = defineTool({
  id: 'list-to-csv',
  title: 'List → CSV',
  description: 'Turn a plain list (one item per line) into a single-column CSV, quoting values safely.',
  category: 'convert',
  options: {
    type: 'object',
    properties: {
      header: { type: 'string', description: 'Optional header for the column (empty = no header).', default: '', maxLength: 200 },
      delimiter: { type: 'string', description: 'Output delimiter name or literal.', default: 'comma', minLength: 1, maxLength: 10 },
      removeEmpty: { type: 'boolean', description: 'Skip empty lines.', default: true },
    },
    additionalProperties: false,
  },
  input: {
    accepts: 'A plain list, one item per line with no field separator (keywords, names, IDs), to put in a single-column CSV with safe quoting.',
    signals: {
      nonEmptyLines: '> 1',
      delimiter: 'null (a delimited list → split-columns)',
      jsonValid: 'false',
      jsonLines: 'false',
      base64DecodesToText: 'false (wrapped Base64 is one value, not a list)',
    },
    avoid: 'Lines that already hold several fields → split-columns. Text an extract or clean tool can handle (list-to-csv is a weak 0.35 fallback).',
    examples: ['apple\nbanana\ncherry'],
  },
  run(input, o) {
    const lines = splitLines(input);
    const items = o.removeEmpty ? lines.filter((l) => l.trim() !== '') : lines;
    const rows = items.map((l) => [l]);
    if (o.header) rows.unshift([o.header]);
    return {
      output: toCsv(rows, resolveDelimiter(o.delimiter)),
      data: items,
      stats: { inputLines: lines.length, outputLines: rows.length, count: items.length, removed: lines.length - items.length },
      warnings: [],
    };
  },
  suggest: (p) =>
    p.nonEmptyLines > 1 && !p.delimiter && !p.jsonValid && !p.jsonLines && !p.base64DecodesToText ? { score: 0.35, reason: 'Plain list' } : null,
});
