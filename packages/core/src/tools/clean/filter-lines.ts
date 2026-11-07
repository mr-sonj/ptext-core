import { PTextError } from '../../types.js';
import { defineTool } from '../../lib/define.js';
import { compileUserRegex } from '../../lib/regex.js';
import { splitLines } from '../../lib/text.js';

export const filterLines = defineTool({
  id: 'filter-lines',
  title: 'Filter lines',
  description: 'Keep (or drop) lines that contain, start with, end with, equal, or match a regex pattern.',
  category: 'clean',
  options: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        description: 'How to match the pattern. Regex mode rejects nested repeats such as "(a+)+".',
        enum: ['contains', 'starts-with', 'ends-with', 'equals', 'regex'],
        default: 'contains',
      },
      pattern: { type: 'string', description: 'Text or regex to match.', maxLength: 500 },
      invert: { type: 'boolean', description: 'Drop matching lines instead of keeping them.', default: false },
      caseSensitive: { type: 'boolean', description: 'Case-sensitive matching.', default: false },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  input: {
    accepts: 'Any multi-line text (logs, lists, exports) when the user wants to keep or drop lines by a word, prefix, suffix, exact value or regex. The pattern comes from the user, so it is never auto-suggested.',
    signals: {},
    avoid: 'Pulling emails, URLs or IPs out of lines → the extract-* tools.',
    examples: ['2026-11-07 10:00:01 ERROR db timeout\n2026-11-07 10:00:02 INFO ok'],
  },
  run(input, o, ctx) {
    if (o.pattern.length > ctx.limits.maxPatternLength) {
      throw new PTextError('INVALID_OPTION', `Pattern longer than ${ctx.limits.maxPatternLength} characters`);
    }
    const lines = splitLines(input);
    let test: (line: string) => boolean;
    if (o.mode === 'regex') {
      const re = compileUserRegex(o.pattern, o.caseSensitive ? 'u' : 'iu');
      test = (l) => re.test(l);
    } else {
      const p = o.caseSensitive ? o.pattern : o.pattern.toLowerCase();
      const norm = (l: string) => (o.caseSensitive ? l : l.toLowerCase());
      test = {
        contains: (l: string) => norm(l).includes(p),
        'starts-with': (l: string) => norm(l).startsWith(p),
        'ends-with': (l: string) => norm(l).endsWith(p),
        equals: (l: string) => norm(l) === p,
      }[o.mode];
    }
    const out = lines.filter((l) => test(l) !== o.invert);
    return {
      output: out.join('\n'),
      data: out,
      stats: { inputLines: lines.length, outputLines: out.length, removed: lines.length - out.length },
      warnings: out.length === 0 ? [{ code: 'NO_MATCH', message: 'No lines matched.' }] : [],
    };
  },
});
