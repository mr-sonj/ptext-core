import type { ToolWarning } from '../../types.js';
import { defineTool } from '../../lib/define.js';
import { splitLines, INVISIBLE_RE } from '../../lib/text.js';

export const cleanLines = defineTool({
  id: 'clean-lines',
  title: 'Clean lines',
  description: 'Trim lines, remove empty lines, collapse repeated spaces and strip invisible characters (zero-width, BOM).',
  category: 'clean',
  options: {
    type: 'object',
    properties: {
      trim: { type: 'boolean', description: 'Trim whitespace at both ends of each line.', default: true },
      removeEmpty: { type: 'boolean', description: 'Remove lines that are empty (after trimming).', default: true },
      collapseSpaces: { type: 'boolean', description: 'Collapse runs of spaces/tabs into a single space.', default: false },
      removeInvisible: { type: 'boolean', description: 'Remove zero-width characters and BOM.', default: true },
    },
    additionalProperties: false,
  },
  input: {
    accepts: 'Messy pasted text: stray blank lines, spaces at line ends, zero-width characters or a BOM copied from a web page, PDF or spreadsheet.',
    signals: {
      hasInvisibleChars: 'true (any one of the three signals is enough; score 0.55)',
      emptyLineRatio: '> 0.1',
      hasTrailingSpaces: 'true',
    },
    avoid: 'Repeated lines → remove-duplicates. Keeping only some lines → filter-lines.',
    examples: ['  a  \n\n\n b\n\nc   \n', 'An\u200b Nguyen\nBinh\uFEFF Tran'],
  },
  run(input, o) {
    const lines = splitLines(input);
    let invisible = 0;
    const out: string[] = [];
    for (let line of lines) {
      if (o.removeInvisible) {
        const before = line.length;
        line = line.replace(INVISIBLE_RE, '');
        invisible += before - line.length;
      }
      if (o.collapseSpaces) line = line.replace(/[ \t ]+/g, ' ');
      if (o.trim) line = line.trim();
      if (o.removeEmpty && line.trim() === '') continue;
      out.push(line);
    }
    const warnings: ToolWarning[] = [];
    if (invisible > 0) warnings.push({ code: 'INVISIBLE_REMOVED', message: `Removed ${invisible} invisible character(s).` });
    return {
      output: out.join('\n'),
      data: out,
      stats: { inputLines: lines.length, outputLines: out.length, removed: lines.length - out.length },
      warnings,
    };
  },
  suggest: (p) =>
    p.hasInvisibleChars || p.emptyLineRatio > 0.1 || p.hasTrailingSpaces
      ? { score: 0.55, reason: 'Has empty lines, trailing spaces or invisible characters' }
      : null,
});
