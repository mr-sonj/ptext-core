import { PROFILE_FIELDS, profileInput, suggestFromProfile, type InputProfile, type Suggestion } from './profiler.js';
import { getTool, listTools } from './registry.js';
import { validateOptions } from './lib/options.js';
import { isDelimited } from './lib/table.js';
import { PTextError, type ToolInfo } from './types.js';

/**
 * Everything a remote ranker needs to judge a profile it cannot see the text of: what each
 * profile field means, and every tool with its input card. Static for a given build.
 */
export interface RouterCatalog {
  /** Hash of fields, tools and routing policy revision. Cache prompts on it. */
  version: string;
  fields: Record<keyof InputProfile, string>;
  tools: ToolInfo[];
}

export interface RouterRequest {
  profile: InputProfile;
  /** Tool ids that passed the local compatibility gate. A remote ranker must choose only from these. */
  eligible?: string[];
  /** Local picks, best first. May be empty. The router may return any eligible tool, not only these. */
  candidates: Suggestion[];
  catalog: RouterCatalog;
  /** Optional, allowlisted task labels. Never free-form user text. */
  intent?: RouteIntent;
}

export interface RouteIntent {
  operation?: 'extract' | 'clean' | 'deduplicate' | 'filter' | 'split' | 'select' | 'convert' | 'encode' | 'decode' | 'format';
  target?: 'emails' | 'urls' | 'domains' | 'ip' | 'lines' | 'columns' | 'csv' | 'json' | 'base64' | 'url-encoded';
}

/**
 * A remote ranker receives ONLY the non-sensitive profile, eligible ids, optional allowlisted intent labels,
 * local candidates and static catalog, never raw text. Implementations live outside core (e.g. a Laravel backend proxy that
 * holds the Jev key, which can send just `catalog.version` and keep the catalog server-side).
 */
export interface RemoteRouter {
  rank(request: RouterRequest, signal: AbortSignal): Promise<Suggestion[]>;
}

export interface RouteOptions {
  router?: RemoteRouter;
  timeoutMs?: number;
  limit?: number;
  /** Controlled task labels supplied by the app; raw text is never accepted here. */
  intent?: RouteIntent;
}

export interface RouteResult {
  profile: InputProfile;
  suggestions: Suggestion[];
  source: 'local' | 'remote';
  fallbackReason?: string;
  /** Remote entries that were dropped or changed, one line each. Absent when there were none. */
  issues?: string[];
}

/** 32-bit FNV-1a: deterministic in every runtime, no crypto API needed. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

let catalog: RouterCatalog | undefined;

/** Bump when rankPrompt or Jev question instructions change, so backend prompt caches refresh. */
const ROUTING_POLICY_REVISION = 3;

/** The catalog a remote router ranks against. Built once; the same object every call. */
export function routerCatalog(): RouterCatalog {
  if (!catalog) {
    const body = { fields: PROFILE_FIELDS, tools: listTools() };
    catalog = { version: fnv1a(JSON.stringify({ ...body, routingPolicyRevision: ROUTING_POLICY_REVISION })), ...body };
  }
  return catalog;
}

const MAX_REASON = 200;

const OPERATIONS = ['extract', 'clean', 'deduplicate', 'filter', 'split', 'select', 'convert', 'encode', 'decode', 'format'];
const TARGETS = ['emails', 'urls', 'domains', 'ip', 'lines', 'columns', 'csv', 'json', 'base64', 'url-encoded'];
const INTENT_TO_TOOL: Record<string, string> = {
  'extract:emails': 'extract-emails',
  'extract:urls': 'extract-urls',
  'extract:domains': 'extract-domains',
  'extract:ip': 'extract-ip',
  'clean:lines': 'clean-lines',
  'deduplicate:lines': 'remove-duplicates',
  'filter:lines': 'filter-lines',
  'split:columns': 'split-columns',
  'select:columns': 'select-columns',
  'convert:json': 'csv-to-json',
  'encode:base64': 'base64',
  'decode:base64': 'base64',
  'encode:url-encoded': 'url-encode',
  'decode:url-encoded': 'url-encode',
  'format:json': 'json-format',
};

function intendedTool(intent?: RouteIntent): string | undefined {
  return intent?.operation && intent.target ? INTENT_TO_TOOL[`${intent.operation}:${intent.target}`] : undefined;
}

function normalizeIntent(value: unknown): RouteIntent | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PTextError('INVALID_OPTION', 'Intent must be an object of controlled labels');
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((k) => k !== 'operation' && k !== 'target')) throw new PTextError('INVALID_OPTION', 'Intent has an unknown field');
  if (raw.operation !== undefined && (typeof raw.operation !== 'string' || !OPERATIONS.includes(raw.operation))) {
    throw new PTextError('INVALID_OPTION', 'Intent operation is not supported');
  }
  if (raw.target !== undefined && (typeof raw.target !== 'string' || !TARGETS.includes(raw.target))) {
    throw new PTextError('INVALID_OPTION', 'Intent target is not supported');
  }
  if (raw.operation === undefined && raw.target === undefined) return undefined;
  return { ...(raw.operation !== undefined ? { operation: raw.operation as RouteIntent['operation'] } : {}), ...(raw.target !== undefined ? { target: raw.target as RouteIntent['target'] } : {}) };
}

function profileConflict(id: string, p: InputProfile, intent?: RouteIntent): string | undefined {
  const requested = intendedTool(intent);
  if ((id === 'split-columns' || id === 'select-columns' || id === 'csv-to-json') && (p.jsonValid || p.jsonLines)) return 'JSON is not delimited data';
  if (id === 'json-format' && p.jsonLines) return 'JSON Lines is not one JSON document';
  if (requested === id) return undefined;
  if ((id === 'split-columns' || id === 'select-columns' || id === 'csv-to-json') && !isDelimited(p)) return 'not delimited data';
  if (id === 'csv-to-json' && p.delimiter !== 'comma' && p.delimiter !== 'tab' && p.delimiter !== 'semicolon') return 'not CSV, TSV or semicolon data';
  if (id === 'base64' && !p.base64DecodesToText) return 'not readable Base64';
  if (id === 'url-encode' && p.percentEncodedCount === 0) return 'no percent-encoded text';
  if (id === 'json-format' && !p.jsonValid && !p.looksLikeJson) return 'not JSON-shaped input';
  if (id === 'extract-emails' && p.emailCount === 0) return 'no email addresses';
  if (id === 'extract-urls' && p.urlCount === 0) return 'no links';
  if (id === 'extract-domains' && p.hostnameCount === 0) return 'no hostnames';
  if (id === 'extract-ip' && p.ipv4Count + p.ipv6Count === 0) return 'no IP addresses';
  if (id === 'remove-duplicates' && p.duplicateLineRatio === 0) return 'no repeated lines';
  if (id === 'clean-lines' && !p.hasInvisibleChars && !p.hasTrailingSpaces && p.emptyLineRatio === 0) return 'no detected cleanup signal';
  if (id === 'filter-lines') return 'filter pattern requires explicit intent';
  if (id === 'list-to-csv' && (p.nonEmptyLines < 2 || !!p.delimiter || p.jsonValid || p.jsonLines || p.base64DecodesToText)) return 'not a plain list';
  return undefined;
}

/** Keep known tools with a compatible profile, one finite score, a bounded reason and valid options. */
function acceptRemote(ranked: unknown, profile: InputProfile, intent: RouteIntent | undefined, eligible: ReadonlySet<string>, issues: string[]): Suggestion[] {
  if (!Array.isArray(ranked)) {
    issues.push('remote did not return an array');
    return [];
  }
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  const requested = intendedTool(intent);
  ranked.forEach((r: unknown, i) => {
    if (!r || typeof r !== 'object') return issues.push(`entry ${i}: not an object`);
    const e = r as Record<string, unknown>;
    const tool = typeof e.tool === 'string' ? getTool(e.tool) : undefined;
    if (!tool) return issues.push(`${String(e.tool)}: unknown tool`);
    const id = tool.id;
    if (seen.has(id)) return issues.push(`${id}: listed twice, kept the first`);
    if (typeof e.score !== 'number' || !Number.isFinite(e.score)) return issues.push(`${id}: score is not a finite number`);
    seen.add(id);
    if (requested && id !== requested) return issues.push(`${id}: conflicts with requested intent`);
    const conflict = profileConflict(id, profile, intent);
    if (conflict) return issues.push(`${id}: ${conflict}`);
    if (!eligible.has(id)) return issues.push(`${id}: outside eligible tools`);
    const clamped = Math.min(1, Math.max(0, e.score));
    if (clamped !== e.score) issues.push(`${id}: score ${e.score} clamped to ${clamped}`);
    const score = Math.round(clamped * 1000) / 1000;
    let reason = '';
    if (typeof e.reason === 'string') {
      reason = e.reason.slice(0, MAX_REASON);
      if (reason.length < e.reason.length) issues.push(`${id}: reason cut to ${MAX_REASON} chars`);
    } else issues.push(`${id}: reason is not a string`);
    const s: Suggestion = { tool: id, score, reason };
    if (e.options !== undefined) {
      try {
        validateOptions(id, tool.options, e.options);
        s.options = e.options as Record<string, unknown>;
      } catch (err) {
        // A missing required option (select-columns `columns`) is the user's to fill in, same as a local suggestion.
        if (err instanceof PTextError && err.message.startsWith('Missing required option')) s.options = e.options as Record<string, unknown>;
        else issues.push(`${id}: options dropped (${(err as Error).message})`);
      }
    }
    if ((id === 'base64' && intent?.target === 'base64') || (id === 'url-encode' && intent?.target === 'url-encoded')) {
      if (intent.operation === 'encode' || intent.operation === 'decode') {
        if (s.options?.direction !== intent.operation) {
          s.options = { ...s.options, direction: intent.operation };
          issues.push(`${id}: direction set to ${intent.operation} from intent`);
        }
      }
    }
    out.push(s);
  });
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Local suggestions first; optionally re-ranked remotely. The router is asked even when local finds
 * nothing when at least one tool is eligible (not for empty input) and may pick any eligible tool. A valid empty reply is an abstention;
 * errors and unusable nonempty replies fall back to local.
 */
export async function route(input: string, opts: RouteOptions = {}): Promise<RouteResult> {
  const profile = profileInput(input);
  const intent = normalizeIntent(opts.intent);
  const limit = opts.limit ?? 5;
  const requested = intendedTool(intent);
  const tools = listTools();
  const localFits = suggestFromProfile(profile, tools.length);
  const possible = new Set(localFits.map((s) => s.tool));
  // One valid %XX sequence is weak evidence for decoding, below the local suggestion threshold of two.
  if (profile.percentEncodedCount > 0) possible.add('url-encode');
  if (requested) possible.add(requested);
  const eligible = tools.filter((t) => possible.has(t.id) && (!requested || t.id === requested) && !profileConflict(t.id, profile, intent)).map((t) => t.id);
  const eligibleSet = new Set(eligible);
  const local = localFits.filter((s) => eligibleSet.has(s.tool)).slice(0, limit);
  if (!opts.router || profile.chars === 0) return { profile, suggestions: local, source: 'local' };
  if (eligible.length === 0) return { profile, suggestions: [], source: 'local' };

  const ctrl = new AbortController();
  let timer: unknown;
  // Race the remote call: aborting the signal alone does not stop a router that ignores it.
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(Object.assign(new Error('timeout'), { name: 'AbortError' }));
    }, opts.timeoutMs ?? 1500);
  });
  try {
    const ranked = await Promise.race([opts.router.rank({ profile, eligible, candidates: local, catalog: routerCatalog(), ...(intent ? { intent } : {}) }, ctrl.signal), timeout]);
    const issues: string[] = [];
    const valid = acceptRemote(ranked, profile, intent, eligibleSet, issues);
    const extra = issues.length ? { issues } : {};
    if (Array.isArray(ranked) && ranked.length === 0) return { profile, suggestions: [], source: 'remote' };
    if (valid.length === 0) return { profile, suggestions: local, source: 'local', fallbackReason: 'remote returned no usable suggestions', ...extra };
    return { profile, suggestions: valid.slice(0, limit), source: 'remote', ...extra };
  } catch (e) {
    return { profile, suggestions: local, source: 'local', fallbackReason: (e as Error).name === 'AbortError' ? 'timeout' : (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}
