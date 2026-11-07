import type { Suggestion, ToolInfo } from './types.js';
import { routerCatalog, type RemoteRouter, type RouterCatalog, type RouterRequest } from './router.js';

/**
 * Jev (TypeSafe System One) as the router. Jev is a decision model: it does not write text, it picks
 * among criteria and returns probabilities. Each tool is one criterion built from its input card, the
 * profile is the state, and the probabilities become the ranking. Core builds the body and reads the
 * answer; the caller makes the HTTP call and holds the key.
 */
export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
export const JEV_MODEL = 'jev-1.13.0';

const QUESTION = 'tool';
const NONE = 'none';

export interface JevQuestion {
  type: 'choice';
  instructions: { question: string; focus: string };
  criteria: Record<string, string>;
}

export interface JevBody {
  model: string;
  state: Record<string, unknown>;
  questions: Record<string, JevQuestion>;
}

export interface JevOptions {
  model?: string;
  /** Send the local candidates as `state.local_rules` (default true). */
  candidates?: boolean;
  /** Send the profile field meanings as `state.fields` (default true). */
  fields?: boolean;
  /** Tools below this probability are left out (default 0.05). */
  minProbability?: number;
}

function criterion(t: ToolInfo): string {
  const signals = Object.entries(t.input.signals).map(([k, v]) => `${k} ${v}`);
  return [
    t.input.accepts,
    signals.length ? `Profile signals: ${signals.join('; ')}.` : 'No profile signal shows when it fits; pick it only when nothing else fits.',
    t.input.avoid ? `Not for: ${t.input.avoid}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

const questions = new Map<string, Record<string, JevQuestion>>();

/** The decision Jev answers: which tool fits, over every catalog tool plus "none". Static per catalog version. */
export function jevQuestions(catalog: RouterCatalog = routerCatalog()): Record<string, JevQuestion> {
  let q = questions.get(catalog.version);
  if (!q) {
    q = {
      [QUESTION]: {
        type: 'choice',
        instructions: {
          question: 'Which PText tool should process this text? You see only its profile (counts and flags measured on the text), never the text itself.',
          focus:
            'Read state.profile with the meanings in state.fields when present. state.local_rules are guesses from fixed rules and can be wrong. Prefer the tool whose profile signals match; pick none when no tool fits.',
        },
        criteria: { ...Object.fromEntries(catalog.tools.map((t) => [t.id, criterion(t)])), [NONE]: 'No PText tool fits this input: plain prose, a single word, or data none of the tools handle.' },
      },
    };
    questions.set(catalog.version, q);
  }
  return q;
}

/** The request body for one profile. Counts and flags only: the text never reaches it. */
export function jevRequest(request: RouterRequest, opts: JevOptions = {}): JevBody {
  const state: Record<string, unknown> = { profile: request.profile };
  if (opts.candidates !== false) state.local_rules = request.candidates.map(({ tool, score }) => ({ tool, score }));
  if (opts.fields !== false) state.fields = request.catalog.fields;
  return { model: opts.model ?? JEV_MODEL, state, questions: jevQuestions(request.catalog) };
}

interface JevAnswer {
  choice?: unknown;
  confidence?: unknown;
  probabilities?: unknown;
}

/**
 * Jev's answers → suggestions, best first. "none" is not a tool, and probabilities under `min` are left out.
 * Options come from the local rule for the same tool (Jev does not produce options). Ids are checked later by route().
 */
export function jevSuggestions(answers: unknown, request: RouterRequest, min = 0.05): Suggestion[] {
  const a = (answers && typeof answers === 'object' ? (answers as Record<string, unknown>)[QUESTION] : undefined) as JevAnswer | undefined;
  if (!a || typeof a !== 'object' || (typeof a.choice !== 'string' && (!a.probabilities || typeof a.probabilities !== 'object'))) {
    throw new Error('Jev answer has no "tool" decision');
  }
  const probs: Record<string, unknown> =
    a.probabilities && typeof a.probabilities === 'object' ? (a.probabilities as Record<string, unknown>) : { [a.choice as string]: a.confidence ?? 0 };
  const local = new Map(request.candidates.map((s) => [s.tool, s]));
  return Object.entries(probs)
    .filter((e): e is [string, number] => e[0] !== NONE && typeof e[1] === 'number' && e[1] >= min)
    .sort((x, y) => y[1] - x[1])
    .map(([tool, p]) => {
      const l = local.get(tool);
      const s: Suggestion = { tool, score: Math.round(p * 1000) / 1000, reason: `Jev ${Math.round(p * 100)}%${l ? ` · ${l.reason}` : ''}` };
      return l?.options ? { ...s, options: l.options } : s;
    });
}

/** The parsed JSON response of `POST JEV_URL` with `body`. The caller adds the key (Authorization: Bearer …). */
export type JevPost = (body: JevBody, signal: AbortSignal) => Promise<unknown>;

/** Jev as a router for `route()`. */
export function jevRouter(post: JevPost, opts: JevOptions = {}): RemoteRouter {
  return {
    async rank(request, signal) {
      const res = await post(jevRequest(request, opts), signal);
      return jevSuggestions(res && typeof res === 'object' ? (res as { answers?: unknown }).answers : undefined, request, opts.minProbability);
    },
  };
}
