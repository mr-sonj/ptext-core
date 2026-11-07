import type { OptionSchema, Suggestion } from './types.js';
import { routerCatalog, type RemoteRouter, type RouterCatalog, type RouterRequest } from './router.js';

/**
 * Any LLM as the remote router: Jev, Claude, GPT, Gemini or a local model all get the same prompt,
 * answer in the same JSON shape and go through the same parser, so they rank against the same facts.
 * Core never calls a model itself; the caller passes the completion function.
 */
export interface RankPrompt {
  /** `catalog.version` the system prompt was built from; cache the system prompt on it. */
  version: string;
  /** Static per catalog: rules, every profile field and every tool's input card. */
  system: string;
  /** JSON of `{ profile, candidates: [{ tool, score }] }`. Absent when only the system prompt was asked for. */
  user?: string;
}

const RULES = `You pick PText tools for a text you cannot see. PText tools are deterministic code that extract, clean, split, convert, encode and format text. You get only the text's profile (counts and flags, defined below) and the candidates proposed by local rules (tool and score). Judge from the profile which tools fit and how well.

Rules:
- Pick from every tool listed below, not only the candidates. Leave out candidates that do not fit.
- score is 0 to 1: how likely this tool is what the user wants for this input.
- options: only options listed for that tool, and only when the profile supports them. Never invent a required option; the user gives it.
- Reply with JSON only, no prose: {"suggestions":[{"tool":"<id>","score":0.9,"reason":"<one short sentence>","options":{}}]}. Best first, at most 5. Reply {"suggestions":[]} when nothing fits.`;

function renderOption(name: string, p: OptionSchema, required: boolean): string {
  const bits: string[] = [p.type];
  if (p.enum) bits.push(`one of ${p.enum.join(' | ')}`);
  if (p.default !== undefined) bits.push(`default ${JSON.stringify(p.default)}`);
  if (p.minimum !== undefined || p.maximum !== undefined) bits.push(`range ${p.minimum ?? ''}–${p.maximum ?? ''}`);
  if (required) bits.push('required, given by the user');
  return `  - ${name} (${bits.join(', ')}): ${p.description}`;
}

function renderSystem(catalog: RouterCatalog): string {
  const fields = Object.entries(catalog.fields).map(([k, v]) => `- ${k}: ${v}`);
  const tools = catalog.tools.map((t) => {
    const signals = Object.entries(t.input.signals).map(([k, v]) => `  - ${k} ${v}`);
    const options = Object.entries(t.options.properties).map(([k, p]) => renderOption(k, p, !!t.options.required?.includes(k)));
    return [
      `## ${t.id} (${t.category})`,
      t.description,
      `Use when: ${t.input.accepts}`,
      ...(t.input.avoid ? [`Not for: ${t.input.avoid}`] : []),
      ...(signals.length ? ['Signals:', ...signals] : ['Signals: none; the profile cannot show when it fits, so pick it only if nothing else does.']),
      ...(options.length ? ['Options:', ...options] : []),
      ...t.input.examples.map((e) => `Example input: ${JSON.stringify(e)}`),
    ].join('\n');
  });
  return [RULES, `Profile fields:\n${fields.join('\n')}`, `Tools:\n\n${tools.join('\n\n')}`].join('\n\n');
}

const systems = new Map<string, string>();

/** The ranking prompt for `catalog`; with a request, also the user message for that profile. */
export function rankPrompt(catalog: RouterCatalog, request?: Pick<RouterRequest, 'profile' | 'candidates'>): RankPrompt {
  let system = systems.get(catalog.version);
  if (system === undefined) systems.set(catalog.version, (system = renderSystem(catalog)));
  const prompt: RankPrompt = { version: catalog.version, system };
  // Tool and score only: the same message a backend that strips reasons and options would send.
  if (request) prompt.user = JSON.stringify({ profile: request.profile, candidates: request.candidates.map(({ tool, score }) => ({ tool, score })) });
  return prompt;
}

/** JSON Schema of the reply, for models with structured output (OpenAI response_format, Gemini responseSchema, ...). */
export function rankResponseSchema(catalog: RouterCatalog = routerCatalog()) {
  return {
    type: 'object' as const,
    properties: {
      suggestions: {
        type: 'array',
        maxItems: 5,
        items: {
          type: 'object',
          properties: {
            tool: { type: 'string', enum: catalog.tools.map((t) => t.id) },
            score: { type: 'number', minimum: 0, maximum: 1 },
            reason: { type: 'string', maxLength: 200 },
            options: { type: 'object', description: 'Only options listed for that tool.' },
          },
          required: ['tool', 'score', 'reason'],
          additionalProperties: false,
        },
      },
    },
    required: ['suggestions'],
    additionalProperties: false as const,
  };
}

function parseJsonIn(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Prose around the JSON: take the outermost {...} or [...].
    const start = text.search(/[[{]/);
    const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
    if (start < 0 || end <= start) return undefined;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

/**
 * The suggestion list out of a model reply: bare JSON, ```json fences, or JSON inside prose;
 * `{ suggestions: [...] }` or a bare array. Entries are checked later by `route()`.
 */
export function parseRankResponse(text: string): unknown[] {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const value = parseJsonIn((fenced ? fenced[1]! : text).trim());
  if (Array.isArray(value)) return value;
  const list = value && typeof value === 'object' ? (value as { suggestions?: unknown }).suggestions : undefined;
  if (Array.isArray(list)) return list;
  throw new Error('model reply is not a ranking (expected {"suggestions": [...]})');
}

/** A completion call to any model: send `system` + `user`, return the reply text. */
export type Complete = (prompt: RankPrompt & { user: string }, signal: AbortSignal) => Promise<string>;

/** Turn any completion function (Jev, a backend proxy, an SDK call) into a router for `route()`. */
export function llmRouter(complete: Complete): RemoteRouter {
  return {
    async rank(request, signal) {
      const prompt = rankPrompt(request.catalog, request) as RankPrompt & { user: string };
      return parseRankResponse(await complete(prompt, signal)) as Suggestion[];
    },
  };
}
