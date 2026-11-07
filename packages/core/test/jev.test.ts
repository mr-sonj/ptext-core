import { describe, expect, it } from 'vitest';
import {
  jevQuestions,
  jevRequest,
  jevRouter,
  jevSuggestions,
  listTools,
  route,
  routerCatalog,
  JEV_MODEL,
  type JevBody,
  type RouterRequest,
} from '@ptext/core';

/** The RouterRequest route() would send for `input`. */
async function requestFor(input: string): Promise<RouterRequest> {
  let req: RouterRequest | undefined;
  await route(input, { router: { rank: async (q) => ((req = q), []) } });
  return req!;
}

describe('Jev adapter (offline)', () => {
  it('asks one choice question: every catalog tool + none, each criterion built from the input card', () => {
    const q = jevQuestions(routerCatalog()).tool;
    expect(q.type).toBe('choice');
    expect(Object.keys(q.criteria)).toEqual([...listTools().map((t) => t.id), 'none']);
    for (const t of listTools()) {
      const c = q.criteria[t.id]!;
      expect(c).toContain(t.input.accepts);
      for (const [k, v] of Object.entries(t.input.signals)) expect(c, `${t.id}.${k}`).toContain(`${k} ${v}`);
      if (t.input.avoid) expect(c).toContain(`Not for: ${t.input.avoid}`);
    }
    expect(jevQuestions(routerCatalog())).toBe(jevQuestions(routerCatalog()));
  });

  it('state is the profile, the local candidates (tool, score) and the field meanings; never the text', async () => {
    const secret = 'SuperSecretToken123';
    const req = await requestFor(`user|${secret}|zq9@leak-check.test\nuser|x|b@leak-check.test`);
    const body = jevRequest(req);
    expect(body.model).toBe(JEV_MODEL);
    expect(body.state).toEqual({ profile: req.profile, eligible_tools: req.eligible, local_rules: req.candidates.map(({ tool, score }) => ({ tool, score })), fields: routerCatalog().fields });
    expect(Object.keys(body.questions.tool.criteria)).toEqual([...req.eligible, 'none']);
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(JSON.stringify(body)).not.toContain('leak-check');
    expect(jevRequest(req, { candidates: false, fields: false, model: 'jev-x' })).toMatchObject({ model: 'jev-x', state: { profile: req.profile } });
    expect(Object.keys(jevRequest(req, { candidates: false, fields: false }).state)).toEqual(['profile', 'eligible_tools']);
  });

  it('sends structured intent alongside the profile when supplied', async () => {
    let req: RouterRequest | undefined;
    await route('https://example.com/a', { intent: { operation: 'extract', target: 'domains' }, router: { rank: async (q) => ((req = q), []) } });
    expect(jevRequest(req!).state.intent).toEqual({ operation: 'extract', target: 'domains' });
  });

  it('probabilities become the ranking: none and tiny ones dropped, rounded, local options kept', async () => {
    const req = await requestFor('user1|pass1|a@x.com\nuser2|pass2|b@x.com');
    const answers = { tool: { choice: 'split-columns', confidence: 0.61234, probabilities: { 'split-columns': 0.61234, none: 0.2, 'extract-emails': 0.15, base64: 0.01 } } };
    const s = jevSuggestions(answers, req);
    expect(s.map((x) => [x.tool, x.score])).toEqual([['split-columns', 0.612], ['extract-emails', 0.15]]);
    expect(s[0]!.options).toEqual({ delimiter: 'pipe' });
    expect(s[0]!.reason).toMatch(/^Jev 61%/);
  });

  it('works with choice + confidence only, and rejects an answer with no tool decision', async () => {
    const req = await requestFor('a@x.com');
    expect(jevSuggestions({ tool: { choice: 'extract-emails', confidence: 0.9 } }, req)).toMatchObject([{ tool: 'extract-emails', score: 0.9 }]);
    expect(jevSuggestions({ tool: { choice: 'none', confidence: 0.8, probabilities: { none: 0.8, 'extract-emails': 0.2 } } }, req)).toEqual([]);
    expect(jevSuggestions({ tool: { probabilities: { none: 0.8, 'extract-emails': 0.2 } } }, req)).toEqual([]);
    expect(() => jevSuggestions({}, req)).toThrowError(/no "tool" decision/);
    expect(() => jevSuggestions(undefined, req)).toThrowError(/no "tool" decision/);
  });

  it('jevRouter plugs into route(): remote on success, issues for unknown ids, local on HTTP failure', async () => {
    let sent: JevBody | undefined;
    const ok = jevRouter(async (body) => {
      sent = body;
      return { answers: { tool: { choice: 'filter-lines', confidence: 0.7, probabilities: { 'filter-lines': 0.7, 'rm-rf': 0.2, none: 0.1 } } } };
    });
    const r = await route('2026-11-07 10:00:01 ERROR db\n2026-11-07 10:00:02 INFO ok', { intent: { operation: 'filter', target: 'lines' }, router: ok });
    expect(r).toMatchObject({ source: 'remote', suggestions: [{ tool: 'filter-lines', score: 0.7 }] });
    expect(sent!.state.profile).toEqual(r.profile);

    const down = jevRouter(async () => {
      throw new Error('Jev 503');
    });
    expect(await route('a@x.com', { router: down })).toMatchObject({ source: 'local', fallbackReason: 'Jev 503' });
  });
});
