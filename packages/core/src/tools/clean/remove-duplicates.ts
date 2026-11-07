import { defineTool } from '../../lib/define.js';
import { splitLines } from '../../lib/text.js';

export const removeDuplicates = defineTool({
  id: 'remove-duplicates',
  title: 'Remove duplicate lines',
  description: 'Remove duplicate lines while keeping the first occurrence and original order.',
  category: 'clean',
  options: {
    type: 'object',
    properties: {
      caseSensitive: { type: 'boolean', description: 'Treat "A" and "a" as different.', default: true },
      trim: { type: 'boolean', description: 'Ignore leading/trailing whitespace when comparing.', default: true },
      keepEmpty: { type: 'boolean', description: 'Keep empty lines (they are never deduplicated).', default: false },
    },
    additionalProperties: false,
  },
  input: {
    accepts: 'A list or log where some lines repeat (emails, keywords, IDs, account rows); keeps the first copy of each line in the original order.',
    signals: { duplicateLineRatio: '> 0; a higher ratio is a stronger fit (score 0.6 + ratio, capped at 0.9)' },
    avoid: 'Repeated emails or URLs inside running text, not whole lines → extract-emails / extract-urls (they dedupe too).',
    examples: ['apple\nbanana\napple\ncherry\nbanana'],
  },
  run(input, o) {
    const lines = splitLines(input);
    const seen = new Set<string>();
    const out: string[] = [];
    let dupes = 0;
    for (const line of lines) {
      if (line.trim() === '') {
        if (o.keepEmpty) out.push(line);
        continue;
      }
      let key = o.trim ? line.trim() : line;
      if (!o.caseSensitive) key = key.toLowerCase();
      if (seen.has(key)) {
        dupes++;
        continue;
      }
      seen.add(key);
      out.push(line);
    }
    return {
      output: out.join('\n'),
      data: out,
      stats: { inputLines: lines.length, outputLines: out.length, removed: lines.length - out.length, count: dupes },
      warnings: [],
    };
  },
  suggest: (p) =>
    p.duplicateLineRatio > 0
      ? { score: 0.6 + Math.min(0.3, p.duplicateLineRatio), reason: `${Math.round(p.duplicateLineRatio * 100)}% duplicate lines` }
      : null,
});
