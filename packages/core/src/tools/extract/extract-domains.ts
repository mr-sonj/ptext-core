import type { ToolWarning } from '../../types.js';
import { defineTool } from '../../lib/define.js';
import { finishList, sortOpt, uniqueOpt } from '../../lib/extract.js';
import { findHosts } from '../../lib/match.js';

export const extractDomains = defineTool({
  id: 'extract-domains',
  title: 'Extract domains',
  description: 'Extract hostnames from URLs, emails and plain text. Returns full hostnames (subdomains kept); does not compute registrable domains.',
  category: 'extract',
  options: {
    type: 'object',
    properties: {
      unique: uniqueOpt,
      sort: sortOpt,
      stripWww: { type: 'boolean', description: 'Remove a leading "www." from hostnames.', default: true },
      fromEmails: { type: 'boolean', description: 'Also take the domain part of email addresses.', default: true },
      skipFileNames: {
        type: 'boolean',
        description: 'Skip bare names that look like files (app.js, notes.md). Reported as FILENAME_LIKE_SKIPPED.',
        default: true,
      },
    },
    additionalProperties: false,
  },
  input: {
    accepts: 'Text with URLs, email addresses or bare hostnames (shop.example.com) when only the hostnames are wanted, lowercased with www. stripped and subdomains kept.',
    signals: {
      urlCount: '> 0 → 0.7',
      emailCount: '> 0 with urlCount 0 → 0.5 (email domains)',
      hostnameCount: '> 0 with urlCount and emailCount 0 → 0.6 (bare hostnames)',
    },
    avoid: 'The full links are wanted → extract-urls. Whole addresses → extract-emails. Registrable domains (a.b.example.co.uk is not reduced to example.co.uk).',
    examples: ['visit https://shop.example.com/a then https://blog.example.org/b', 'example.com\nshop.example.org\napi.example.net'],
  },
  run(input, o) {
    const { hosts, skipped } = findHosts(input, o);
    const warnings: ToolWarning[] = skipped
      ? [{ code: 'FILENAME_LIKE_SKIPPED', message: `Skipped ${skipped} name(s) that look like files (e.g. app.js); set skipFileNames=false to keep them.` }]
      : [];
    return finishList(input, hosts, o, undefined, warnings);
  },
  suggest(p) {
    if (p.urlCount > 0) return { score: 0.7, reason: 'URLs contain domains' };
    if (p.emailCount > 0) return { score: 0.5, reason: 'Emails contain domains' };
    if (p.hostnameCount > 0) return { score: 0.6, reason: `${p.hostnameCount} bare hostname(s)` };
    return null;
  },
});
