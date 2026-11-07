import { PROFILE_FIELDS, profileInput, suggestFromProfile, type InputProfile, type Suggestion } from './profiler.js';
import { getTool, listTools } from './registry.js';
import { validateOptions } from './lib/options.js';
import { PTextError, type ToolInfo } from './types.js';

/**
 * Everything a remote ranker needs to judge a profile it cannot see the text of: what each
 * profile field means, and every tool with its input card. Static for a given build.
 */
export interface RouterCatalog {
  /** Hash of `fields` + `tools`. Changes whenever a tool, a card or a field description changes; cache on it. */
  version: string;
  fields: Record<keyof InputProfile, string>;
  tools: ToolInfo[];
}

export interface RouterRequest {
  profile: InputProfile;
  /** Local picks, best first. May be empty. The router may return any catalog tool, not only these. */
  candidates: Suggestion[];
  catalog: RouterCatalog;
}

/**
 * A remote ranker receives ONLY the non-sensitive profile, the local candidates and the static
 * catalog, never raw text. Implementations live outside core (e.g. a Laravel backend proxy that
 * holds the Jev key, which can send just `catalog.version` and keep the catalog server-side).
 */
export interface RemoteRouter {
  rank(request: RouterRequest, signal: AbortSignal): Promise<Suggestion[]>;
}

export interface RouteOptions {
  router?: RemoteRouter;
  timeoutMs?: number;
  limit?: number;
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

/** The catalog a remote router ranks against. Built once; the same object every call. */
export function routerCatalog(): RouterCatalog {
  if (!catalog) {
    const body = { fields: PROFILE_FIELDS, tools: listTools() };
    catalog = { version: fnv1a(JSON.stringify(body)), ...body };
  }
  return catalog;
}

const MAX_REASON = 200;

/** Keep well-formed entries: a known tool, once, a finite score clamped to 0–1, a string reason, options valid for the tool. */
function acceptRemote(ranked: unknown, issues: string[]): Suggestion[] {
  if (!Array.isArray(ranked)) {
    issues.push('remote did not return an array');
    return [];
  }
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  ranked.forEach((r: unknown, i) => {
    if (!r || typeof r !== 'object') return issues.push(`entry ${i}: not an object`);
    const e = r as Record<string, unknown>;
    const tool = typeof e.tool === 'string' ? getTool(e.tool) : undefined;
    if (!tool) return issues.push(`${String(e.tool)}: unknown tool`);
    const id = tool.id;
    if (seen.has(id)) return issues.push(`${id}: listed twice, kept the first`);
    if (typeof e.score !== 'number' || !Number.isFinite(e.score)) return issues.push(`${id}: score is not a finite number`);
    seen.add(id);
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
    out.push(s);
  });
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Local suggestions first; optionally re-ranked remotely. The router is asked even when local finds
 * nothing (not for empty input) and may pick any catalog tool. Any remote failure falls back to local.
 */
export async function route(input: string, opts: RouteOptions = {}): Promise<RouteResult> {
  const profile = profileInput(input);
  const limit = opts.limit ?? 5;
  const local = suggestFromProfile(profile, limit);
  if (!opts.router || profile.chars === 0) return { profile, suggestions: local, source: 'local' };

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
    const ranked = await Promise.race([opts.router.rank({ profile, candidates: local, catalog: routerCatalog() }, ctrl.signal), timeout]);
    const issues: string[] = [];
    const valid = acceptRemote(ranked, issues);
    const extra = issues.length ? { issues } : {};
    if (valid.length === 0) return { profile, suggestions: local, source: 'local', fallbackReason: 'remote returned no usable suggestions', ...extra };
    return { profile, suggestions: valid.slice(0, limit), source: 'remote', ...extra };
  } catch (e) {
    return { profile, suggestions: local, source: 'local', fallbackReason: (e as Error).name === 'AbortError' ? 'timeout' : (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}
