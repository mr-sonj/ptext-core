import type { InputProfile, Suggestion } from './types.js';
import { splitLines } from './lib/text.js';
import { detectDelimiter, parseDelimited } from './lib/csv.js';
import { findEmails, findHosts, findIps, findUrls } from './lib/match.js';
import { ALL } from './registry.js';

export type { InputProfile, Suggestion };

const DELIM_NAME: Record<string, InputProfile['delimiter']> = { '\t': 'tab', ',': 'comma', '|': 'pipe', ';': 'semicolon', ':': 'colon' };

/** Profile at most this many chars; keeps suggestion fast on huge inputs. */
const SAMPLE_CHARS = 200_000;

/**
 * What each profile field means, exactly. Sent to the remote router with the catalog, so a ranker that
 * never sees the text knows what the numbers say. Typed as a Record so a new field cannot ship undocumented.
 */
export const PROFILE_FIELDS: Record<keyof InputProfile, string> = {
  chars: 'Length of the whole input in UTF-16 code units. Every other field is measured on the first 200,000 chars only; compare with this to know whether the input was sampled.',
  lines: 'Lines in the sample (split on \\n, \\r\\n or \\r). A single trailing newline does not add a line.',
  nonEmptyLines: 'Lines in the sample that are not empty or whitespace-only.',
  duplicateLineRatio: '0–1. Share of non-empty lines that repeat an earlier line (compared trimmed, case-sensitive). 0 = every line is unique.',
  emptyLineRatio: '0–1. Share of lines that are empty or whitespace-only.',
  emailCount: 'Email addresses found by the extract-emails matcher, duplicates included. Unicode (IDN) addresses and +tags count.',
  urlCount: 'http(s):// and www. links found by the extract-urls matcher, duplicates included. Bare hostnames such as example.com do not count here.',
  hostnameCount:
    'Hostnames found by the extract-domains matcher with its defaults: inside URLs, the domain of each email, and bare names such as shop.example.com. File-like names (app.js, notes.md) are skipped. Duplicates included. More than urlCount + emailCount usually means bare hostnames are present.',
  ipv4Count: 'Valid IPv4 addresses (each octet 0–255; ip:port counts once) found by the extract-ip matcher, including the IPv4 tail of ::ffff:1.2.3.4. Duplicates included. Version strings shaped like 1.2.3.4 also count.',
  ipv6Count: 'Valid IPv6 addresses (full, compressed with ::, IPv4-mapped, [addr]:port) found by the extract-ip matcher. Duplicates included.',
  delimiter:
    'Field separator detected from the first 50 non-empty lines: tab, comma, pipe, semicolon, colon, or null. Picked by how consistently it splits lines into the same number of fields. Colons in clock times, URL schemes, IPv6 addresses and Windows drives, and semicolons in HTML entities, are ignored. The column tools use the same detection in "auto" mode.',
  columnCount: 'Fields in the first non-empty line split by the detected delimiter (CSV quotes respected). 1 when delimiter is null.',
  looksLikeJson: 'The trimmed sample starts with { or [ and ends with } or ].',
  jsonValid: 'The trimmed sample parses as one JSON document.',
  jsonLines: 'At least 2 non-empty lines and each one parses as JSON on its own (JSON Lines / NDJSON). Such input is not one JSON document, so jsonValid is false.',
  looksLikeBase64:
    'With whitespace removed, the sample is at least 16 chars of the Base64 or Base64url alphabet with valid padding and length, and contains a digit, +, / or =, or both upper- and lowercase letters. Hex hashes and UUIDs also pass this check.',
  base64DecodesToText: 'looksLikeBase64, and the sample decodes to valid UTF-8 with no control characters other than tab and newlines. False for hashes, UUIDs and binary payloads.',
  percentEncodedCount: 'Number of %XX sequences (percent sign + two hex digits), e.g. %20 or %C3%A0.',
  hasInvisibleChars: 'Contains a zero-width character (U+200B–U+200D, U+2060) or a BOM (U+FEFF).',
  hasTrailingSpaces: 'At least one line ends with a space or tab.',
};

export function profileInput(input: string): InputProfile {
  const sampled = input.length > SAMPLE_CHARS;
  const sample = sampled ? input.slice(0, SAMPLE_CHARS) : input;
  const lines = splitLines(sample);
  const nonEmpty = lines.filter((l) => l.trim() !== '');
  const uniq = new Set(nonEmpty.map((l) => l.trim()));
  const delimiter = detectDelimiter(nonEmpty);
  const trimmed = sample.trim();
  const looksLikeJson = /^[[{]/.test(trimmed) && /[\]}]$/.test(trimmed);
  const jsonValid = looksLikeJson && parses(trimmed);
  // The last line of a sampled input may be cut in half.
  const jsonCandidates = sampled ? nonEmpty.slice(0, -1) : nonEmpty;
  const jsonLines = jsonCandidates.length >= 2 && jsonCandidates.every((l) => /^\s*[[{]/.test(l) && parses(l));
  const compact = trimmed.replace(/\s+/g, '');
  const looksLikeBase64 =
    compact.length >= 16 && compact.length % 4 !== 1 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(compact) && /[0-9+/=]|[a-z].*[A-Z]|[A-Z].*[a-z]/.test(compact) && !/^[a-z]+$/i.test(compact);

  return {
    chars: input.length,
    lines: lines.length,
    nonEmptyLines: nonEmpty.length,
    duplicateLineRatio: nonEmpty.length ? round(1 - uniq.size / nonEmpty.length) : 0,
    emptyLineRatio: lines.length ? round((lines.length - nonEmpty.length) / lines.length) : 0,
    emailCount: findEmails(sample).length,
    urlCount: findUrls(sample).length,
    hostnameCount: findHosts(sample, { fromEmails: true, skipFileNames: true, stripWww: true }).hosts.length,
    ipv4Count: findIps(sample, '4', false).length,
    ipv6Count: findIps(sample, '6', false).length,
    delimiter: delimiter ? DELIM_NAME[delimiter] ?? null : null,
    columnCount: delimiter && nonEmpty[0] ? parseDelimited(nonEmpty[0], delimiter).rows[0]?.length ?? 1 : 1,
    looksLikeJson,
    jsonValid,
    jsonLines,
    looksLikeBase64,
    base64DecodesToText: looksLikeBase64 && decodesToText(compact, sampled),
    percentEncodedCount: (sample.match(/%[0-9A-F]{2}/gi) ?? []).length,
    hasInvisibleChars: /[​-‍⁠﻿]/.test(sample),
    hasTrailingSpaces: lines.some((l) => /[ \t]+$/.test(l)),
  };
}

function parses(json: string): boolean {
  try {
    JSON.parse(json);
    return true;
  } catch {
    return false;
  }
}

/** Same alphabet handling as the base64 tool's decode. A sampled input is cut to whole bytes and whole characters. */
function decodesToText(compact: string, sampled: boolean): boolean {
  let b64 = compact.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (sampled) b64 = b64.slice(0, b64.length - (b64.length % 4));
  if (b64.length % 4 === 1) return false;
  let bytes: Uint8Array;
  try {
    const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return false;
  }
  if (sampled) bytes = dropCutUtf8(bytes);
  try {
    return !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return false;
  }
}

/** Drop a UTF-8 sequence cut off at the end of the bytes. */
function dropCutUtf8(b: Uint8Array): Uint8Array {
  let i = b.length - 1;
  while (i > 0 && b.length - i < 4 && (b[i]! & 0xc0) === 0x80) i--;
  const lead = b[i] ?? 0;
  const need = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
  return b.length - i < need ? b.subarray(0, i) : b;
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}

/**
 * Deterministic, local rules: each tool's own `suggest(profile)`. No network, no key.
 * Ties keep catalog order (Array#sort is stable).
 */
export function suggestFromProfile(p: InputProfile, limit = 5): Suggestion[] {
  if (p.chars === 0) return [];
  const s: Suggestion[] = [];
  for (const t of ALL) {
    const fit = t.suggest?.(p);
    if (!fit) continue;
    const score = round(fit.score);
    s.push(fit.options ? { tool: t.id, score, reason: fit.reason, options: fit.options } : { tool: t.id, score, reason: fit.reason });
  }
  return s.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function suggestTools(input: string, limit = 5): { profile: InputProfile; suggestions: Suggestion[] } {
  const profile = profileInput(input);
  return { profile, suggestions: suggestFromProfile(profile, limit) };
}
