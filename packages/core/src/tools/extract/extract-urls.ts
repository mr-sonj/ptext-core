import { defineTool } from '../../lib/define.js';
import { finishList, sortOpt, uniqueOpt } from '../../lib/extract.js';
import { findUrls } from '../../lib/match.js';

export const extractUrls = defineTool({
  id: 'extract-urls',
  title: 'Extract URLs',
  description: 'Find http(s):// and www. links in text, trimming trailing punctuation and unbalanced brackets.',
  category: 'extract',
  options: { type: 'object', properties: { unique: uniqueOpt, sort: sortOpt }, additionalProperties: false },
  input: {
    accepts: 'Text with http(s):// or www. links in it: logs, HTML, Markdown, chat, or a list of links that needs deduping.',
    signals: { urlCount: '> 0' },
    avoid: 'Only the hostnames are wanted → extract-domains. Bare names like example.com with no scheme or www. are not links → extract-domains.',
    examples: ['GET https://api.example.com/v1/users 200\nGET https://api.example.com/v1/items 404', 'Docs: (https://ptext.org/docs), mirror www.example.org.'],
  },
  run(input, o) {
    return finishList(input, findUrls(input), o);
  },
  suggest: (p) => (p.urlCount > 0 ? { score: 0.85, reason: `${p.urlCount} URL(s)` } : null),
});
