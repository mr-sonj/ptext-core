import { INVISIBLE_RE, trimTrailingPunctuation } from './text.js';

// Finders shared by the extract tools and the profiler, so a profile count is exactly what the tool returns.

// Unicode local part & domain (EAI / IDN) allowed; label rules on the domain.
export const EMAIL_RE = /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}](?:[\p{L}\p{N}._%+-]{0,62}[\p{L}\p{N}_%+-])?@(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+[\p{L}]{2,63}(?![\p{L}\p{N}-])/gu;

/** Email addresses in text order, as written (invisible characters removed first). */
export function findEmails(input: string): string[] {
  return (input.replace(INVISIBLE_RE, '').match(EMAIL_RE) ?? []).filter((e) => !e.split('@')[0]!.includes('..'));
}

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'` ]+/giu;

/** Strip trailing punctuation and unbalanced closing brackets. */
function tidyUrl(raw: string): string {
  let url = raw;
  for (;;) {
    const before = url;
    url = trimTrailingPunctuation(url);
    for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']] as const) {
      if (url.endsWith(close)) {
        const opens = url.split(open).length - 1;
        const closes = url.split(close).length - 1;
        if (closes > opens) url = url.slice(0, -1);
      }
    }
    if (url === before) return url;
  }
}

/** http(s):// and www. links in text order, trailing punctuation trimmed. */
export function findUrls(input: string): string[] {
  return (input.replace(INVISIBLE_RE, '').match(URL_RE) ?? []).map(tidyUrl).filter((u) => u.length > 4);
}

const HOST_RE = /(?<![\p{L}\p{N}@.-])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+[\p{L}]{2,63}(?![\p{L}\p{N}-]|\.[\p{L}\p{N}])/gu;
// Some of these are real TLDs (.md, .py, .sh, .zip), so skipping is reported and can be turned off.
const COMMON_FILE_EXT = new Set(['js', 'ts', 'css', 'json', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'txt', 'md', 'php', 'py', 'html', 'htm', 'xml', 'csv', 'pdf', 'zip', 'exe', 'log', 'yml', 'yaml', 'sh', 'mjs', 'vue', 'jsx', 'tsx']);

export interface HostOptions {
  fromEmails: boolean;
  skipFileNames: boolean;
  stripWww: boolean;
}

/** Lowercased hostnames from URLs, emails and bare names, in text order, plus how many file-like names were skipped. */
export function findHosts(input: string, o: HostOptions): { hosts: string[]; skipped: number } {
  const text = input.replace(INVISIBLE_RE, '');
  const hosts: string[] = [];
  let skipped = 0;
  // Hostnames, keeping their textual order. Emails handled separately to honor `fromEmails`.
  const re = new RegExp(`${EMAIL_RE.source}|${HOST_RE.source}`, 'gu');
  for (const m of text.matchAll(re)) {
    let h = m[0];
    if (h.includes('@')) {
      if (!o.fromEmails) continue;
      h = h.slice(h.lastIndexOf('@') + 1);
    }
    h = h.toLowerCase();
    const tld = h.slice(h.lastIndexOf('.') + 1);
    if (o.skipFileNames && COMMON_FILE_EXT.has(tld) && !/^(?:www\.)/.test(h) && h.split('.').length === 2) {
      skipped++;
      continue;
    }
    if (o.stripWww) h = h.replace(/^www\./, '');
    hosts.push(h);
  }
  return { hosts, skipped };
}

const IPV4 = '(?:(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4_RE = new RegExp(`(?<![\\d.])${IPV4}(?![\\d]|\\.\\d)(?::(\\d{1,5}))?`, 'g');
// The last group may be an embedded IPv4 (::ffff:192.168.1.1); never stop right before ".<digit>", or "::ffff:192" is cut out of one.
const IPV6_CANDIDATE_RE = new RegExp(`\\[?(?<![\\w:])(?:[0-9a-f]{0,4}:){2,7}(?:${IPV4}|[0-9a-f]{0,4})(?:%\\w+)?(?![\\w:]|\\.\\d)\\]?(?::(\\d{1,5}))?`, 'gi');

function isValidIPv6(s: string): boolean {
  // An embedded IPv4 tail counts as two 16-bit groups.
  const addr = s.replace(/%\w+$/, '').replace(/(?:\d{1,3}\.){3}\d{1,3}$/, '0:0');
  if (addr.split('::').length > 2) return false;
  const hasDouble = addr.includes('::');
  const parts = addr.split(':').filter((p, i, arr) => !(p === '' && (i === 0 || i === arr.length - 1) && hasDouble));
  const groups = parts.filter((p) => p !== '');
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return false;
  return hasDouble ? groups.length < 8 : groups.length === 8;
}

export interface IpMatch {
  /** Offset of the whole match (brackets and port included) in the input. */
  index: number;
  /** Length of the whole match. */
  length: number;
  value: string;
}

/** Valid IP addresses in text order. `version: 'any'` does not list the IPv4 tail of ::ffff:1.2.3.4 twice. */
export function findIps(input: string, version: 'any' | '4' | '6', keepPort: boolean): IpMatch[] {
  const found: IpMatch[] = [];
  // Offsets of IPv4 tails inside accepted IPv6 addresses.
  const embeddedV4 = new Set<number>();
  if (version !== '4') {
    for (const m of input.matchAll(IPV6_CANDIDATE_RE)) {
      const raw = m[0];
      const port = m[1];
      const bracketed = raw.startsWith('[');
      let addr = raw;
      if (bracketed && port) addr = raw.slice(1, raw.lastIndexOf(']'));
      else addr = raw.replace(/^\[|\]$/g, '');
      if (!bracketed && port) addr = raw; // unbracketed: the ":port" is ambiguous, treat as part of address
      if (!isValidIPv6(addr)) continue;
      // An unbracketed bare "::" is almost always punctuation (C++ "a :: b"); "[::]:80" stays.
      if (!bracketed && !/[0-9a-f]/i.test(addr)) continue;
      const dot = raw.indexOf('.');
      if (dot >= 0) embeddedV4.add(m.index! + raw.lastIndexOf(':', dot) + 1);
      const v = addr.toLowerCase();
      found.push({ index: m.index!, length: raw.length, value: keepPort && bracketed && port ? `[${v}]:${port}` : v });
    }
  }
  if (version !== '6') {
    for (const m of input.matchAll(IPV4_RE)) {
      if (version === 'any' && embeddedV4.has(m.index!)) continue;
      const port = m[1];
      const ip = port ? m[0].slice(0, -(port.length + 1)) : m[0];
      const portOk = port && Number(port) <= 65535;
      found.push({ index: m.index!, length: m[0].length, value: keepPort && portOk ? `${ip}:${port}` : ip });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}
