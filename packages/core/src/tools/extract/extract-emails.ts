import { defineTool } from '../../lib/define.js';
import { finishList, sortOpt, uniqueOpt } from '../../lib/extract.js';
import { findEmails } from '../../lib/match.js';

export const extractEmails = defineTool({
  id: 'extract-emails',
  title: 'Extract emails',
  description: 'Find all email addresses in any text (logs, HTML, CSV, chat). Supports + tags and Unicode.',
  category: 'extract',
  options: {
    type: 'object',
    properties: {
      unique: uniqueOpt,
      sort: sortOpt,
      lowercase: { type: 'boolean', description: 'Lowercase the domain part (local part is kept as-is).', default: true },
    },
    additionalProperties: false,
  },
  input: {
    accepts: 'Any text with email addresses in it: chat, logs, HTML, mail headers, CSV rows, or a list that needs deduping and lowercasing.',
    signals: {
      emailCount: '> 0',
      delimiter: 'null, together with emailCount ≥ 90% of nonEmptyLines: already one address per line, weaker fit (0.6 instead of 0.9)',
      nonEmptyLines: 'compared with emailCount, see delimiter',
    },
    avoid: 'Only the domains are wanted → extract-domains. The emails are one column of a delimited table and the other columns matter → select-columns.',
    examples: ['Hi team, ping john@acme.com or sales@acme.io for details.', 'From: "An" <an@x.com>\nTo: binh+news@ví-dụ.vn'],
  },
  run(input, o) {
    const found = findEmails(input).map((e) => {
      if (!o.lowercase) return e;
      const at = e.lastIndexOf('@');
      return e.slice(0, at) + '@' + e.slice(at + 1).toLowerCase();
    });
    return finishList(input, found, o, (e) => e.toLowerCase());
  },
  suggest(p) {
    if (p.emailCount === 0) return null;
    const pure = p.delimiter === null && p.emailCount >= p.nonEmptyLines * 0.9;
    return { score: pure ? 0.6 : 0.9, reason: `${p.emailCount} email-like token(s)` };
  },
});
