import { defineTool } from '../../lib/define.js';
import { finishList, sortOpt, uniqueOpt } from '../../lib/extract.js';
import { findIps } from '../../lib/match.js';

export const extractIp = defineTool({
  id: 'extract-ip',
  title: 'Extract IP addresses',
  description: 'Find valid IPv4 and IPv6 addresses (incl. compressed IPv6, IPv4-mapped IPv6 and ip:port) in text.',
  category: 'extract',
  options: {
    type: 'object',
    properties: {
      version: { type: 'string', description: 'Which IP versions to extract.', enum: ['any', '4', '6'], default: 'any' },
      keepPort: { type: 'boolean', description: 'Keep ":port" suffix when present.', default: false },
      unique: uniqueOpt,
      sort: sortOpt,
    },
    additionalProperties: false,
  },
  input: {
    accepts: 'Text with IPv4 or IPv6 addresses in it: server and access logs, firewall output, proxy lists (ip:port), config files. Only valid addresses are returned.',
    signals: { ipv4Count: '> 0, or ipv6Count > 0', ipv6Count: '> 0, or ipv4Count > 0' },
    avoid: 'Version strings such as 1.2.3.4 (valid IPv4, so they would be extracted). Keeping ip and port as two columns → split-columns.',
    examples: ['192.168.1.10 - - [07/Nov/2026] "GET /"\n10.0.0.5 - - [07/Nov/2026] "GET /x"', '2001:db8::1\nfe80::1\n[::1]:8080'],
  },
  run(input, o) {
    return finishList(input, findIps(input, o.version, o.keepPort).map((m) => m.value), o);
  },
  suggest(p) {
    const n = p.ipv4Count + p.ipv6Count;
    return n > 0 ? { score: 0.8, reason: `${n} IP address(es)` } : null;
  },
});
