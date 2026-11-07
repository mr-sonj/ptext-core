import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  runTool,
  listTools,
  suggestTools,
  profileInput,
  route,
  routerCatalog,
  rankPrompt,
  rankResponseSchema,
  parseRankResponse,
  llmRouter,
  type RankPrompt,
  openAITools,
  anthropicTools,
  handleToolCall,
  modelDescription,
  errorToJSON,
  PTextError,
  PROFILE_FIELDS,
  type InputProfile,
  type RouterRequest,
} from '@ptext/core';
import { TOOLS } from '../src/tools/index.js';
import { loadGolden, loadSuggestCorpus } from '../../../fixtures/load.js';

const golden = loadGolden();
const corpus = loadSuggestCorpus();
const repo = (p: string) => new URL(`../../../${p}`, import.meta.url);

const byTool = new Map<string, typeof golden>();
for (const c of golden) byTool.set(c.tool, [...(byTool.get(c.tool) ?? []), c]);

describe('golden fixtures', () => {
  for (const [tool, cases] of byTool) {
    describe(tool, () => {
      for (const c of cases) {
        it(c.name, () => {
          if (c.expectError) {
            let err: unknown;
            try {
              runTool(c.tool, c.input, c.options);
            } catch (e) {
              err = e;
            }
            expect(err).toBeInstanceOf(PTextError);
            expect((err as PTextError).code).toBe(c.expectError);
            return;
          }
          const r = runTool(c.tool, c.input, c.options);
          expect(r.output).toBe(c.expect!.output);
          expect(r.warnings.map((w) => w.code)).toEqual(c.expect!.warnings);
        });
      }
    });
  }
});

// The tool rules from CONTRIBUTING.md, enforced so a new tool cannot land half-done.
describe('catalog', () => {
  for (const t of TOOLS) {
    describe(t.id, () => {
      const cases = golden.filter((c) => c.tool === t.id && c.file !== 'golden/_registry.json');
      it('lives in tools/<category>/<id>.ts', () => {
        expect(existsSync(repo(`packages/core/src/tools/${t.category}/${t.id}.ts`))).toBe(true);
      });
      it('has its own fixture file with ≥ 1 happy and ≥ 1 edge/error case', () => {
        expect(cases.every((c) => c.file === `golden/${t.id}.json`), 'cases outside golden/<id>.json').toBe(true);
        expect(cases.length, `fixtures/golden/${t.id}.json`).toBeGreaterThan(0);
        expect(cases.filter((c) => !c.edge).length, 'happy cases').toBeGreaterThanOrEqual(1);
        expect(cases.filter((c) => c.edge).length, 'edge/error cases').toBeGreaterThanOrEqual(1);
      });
      it('has no placeholder left from pnpm new-tool', () => {
        expect(JSON.stringify([t.title, t.description, t.input, cases])).not.toMatch(/TODO/);
      });
      it('every option has a description', () => {
        for (const [k, p] of Object.entries(t.options.properties)) expect(p.description, k).toBeTruthy();
      });
      if (t.suggest) {
        it('suggest rule has a fixtures/suggest.json case', () => {
          expect(corpus.map((c) => c.expectTop3)).toContain(t.id);
        });
      }
    });
  }
  it('ids are unique kebab-case', () => {
    const ids = TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
  });
  it('every fixture file belongs to a tool', () => {
    const ids = new Set(TOOLS.map((t) => t.id));
    for (const c of golden) if (c.file !== 'golden/_registry.json') expect(ids, c.file).toContain(c.tool);
  });
  it('README tools table has one row per tool, matching the catalog', () => {
    const readme = readFileSync(repo('README.md'), 'utf8');
    const rows = readme.split('\n').filter((l) => /^\| `[a-z0-9-]+` \| [a-z]+ \| .* \|$/.test(l));
    expect(rows, 'README rows in catalog order').toEqual(
      listTools().map((t) => `| \`${t.id}\` | ${t.category} | ${t.description.replace(/\|/g, '\\|')} |`),
    );
  });
  it('catalog is JSON-serializable and grouped by category', () => {
    expect(() => JSON.stringify(listTools())).not.toThrow();
    const cats = listTools().map((t) => t.category);
    expect(cats.filter((c, i) => c !== cats[i - 1])).toEqual([...new Set(cats)]);
  });
});

// Every input the tests know: the AI and Jev only judge as well as these cards and fields are exact.
const SAMPLES = [...new Set([...corpus.map((c) => c.input), ...golden.map((c) => c.input), ...TOOLS.flatMap((t) => t.input.examples)])];
const PROFILES = SAMPLES.map(profileInput);

describe('input cards', () => {
  const fields = Object.keys(PROFILE_FIELDS);
  it('PROFILE_FIELDS describes every profile field and nothing else', () => {
    expect(Object.keys(profileInput('x')).sort()).toEqual([...fields].sort());
    for (const [k, v] of Object.entries(PROFILE_FIELDS)) expect(v.length, k).toBeGreaterThan(30);
  });
  for (const t of TOOLS) {
    describe(t.id, () => {
      it('has an input card with 1–3 short examples and real signal fields', () => {
        expect(t.input.accepts.length).toBeGreaterThan(30);
        expect(t.input.examples.length).toBeGreaterThanOrEqual(1);
        expect(t.input.examples.length).toBeLessThanOrEqual(3);
        for (const e of t.input.examples) expect(e.length, e).toBeLessThanOrEqual(300);
        for (const [k, v] of Object.entries(t.input.signals)) {
          expect(fields, k).toContain(k);
          expect(v, k).toBeTruthy();
        }
        if (!t.suggest) expect(t.input.signals).toEqual({});
      });
      if (t.suggest) {
        it('signals name exactly the profile fields its rule reads', () => {
          const read = new Set<string>();
          const spy = (p: InputProfile) => new Proxy(p, { get: (o, k) => (read.add(String(k)), Reflect.get(o, k)) });
          for (const p of PROFILES) t.suggest!(spy(p));
          expect([...read].sort()).toEqual(Object.keys(t.input.signals).sort());
        });
        it('every example fires its rule and ranks it top-3', () => {
          for (const e of t.input.examples) {
            expect(t.suggest!(profileInput(e)), e).not.toBeNull();
            expect(suggestTools(e).suggestions.slice(0, 3).map((s) => s.tool), e).toContain(t.id);
          }
        });
      }
    });
  }
});

describe('profile counts use the tools’ own matchers', () => {
  const count = (tool: string, input: string, options: Record<string, unknown> = {}) =>
    (runTool(tool, input, { unique: false, ...options }).data as unknown[]).length;
  it('emailCount, urlCount, ipv4Count, ipv6Count, hostnameCount equal what the tool extracts', () => {
    for (const input of SAMPLES) {
      const p = profileInput(input);
      const got = [p.emailCount, p.urlCount, p.ipv4Count, p.ipv6Count, p.hostnameCount];
      const want = [
        count('extract-emails', input),
        count('extract-urls', input),
        count('extract-ip', input, { version: '4' }),
        count('extract-ip', input, { version: '6' }),
        count('extract-domains', input),
      ];
      expect(got, JSON.stringify(input)).toEqual(want);
    }
  });
  it('stays fast on the largest input', () => {
    const big = 'a@x.com 10.0.0.1 2001:db8::1 https://x.com/a, b;c|d:e\n'.repeat(100_000);
    const t = performance.now();
    profileInput(big);
    expect(performance.now() - t).toBeLessThan(1000);
  });
});

describe('profiler (local suggestions)', () => {
  for (const c of corpus) {
    it(c.name, () => {
      const tools = suggestTools(c.input).suggestions.map((s) => s.tool);
      if (c.expectTop3) expect(tools.slice(0, 3)).toContain(c.expectTop3);
      for (const id of c.expectNotSuggested ?? []) expect(tools, id).not.toContain(id);
    });
  }
  it('corpus only names real tools', () => {
    const ids = TOOLS.map((t) => t.id);
    for (const c of corpus) for (const id of [c.expectTop3 ?? ids[0]!, ...(c.expectNotSuggested ?? [])]) expect(ids, c.name).toContain(id);
  });
  it('profile contains no raw text', () => {
    const secret = 'SuperSecretToken123';
    const { profile } = suggestTools(`user|${secret}|a@x.com`);
    expect(JSON.stringify(profile)).not.toContain(secret);
    expect(JSON.stringify(profile)).not.toContain('a@x.com');
  });
  it('suggested options are valid for the tool', () => {
    for (const c of corpus) {
      for (const s of suggestTools(c.input).suggestions) {
        try {
          runTool(s.tool, 'x', s.options);
        } catch (e) {
          // Required options (select-columns `columns`) are the user's choice; any other option error is a bad rule.
          if ((e as PTextError).code === 'INVALID_OPTION') expect((e as Error).message, s.tool).toMatch(/^Missing required option/);
        }
      }
    }
  });
});

describe('router fallback', () => {
  it('preserves an explicit remote abstention instead of reviving local guesses', async () => {
    const r = await route('apple\nbanana\ncherry', { router: { rank: async () => [] } });
    expect(r).toEqual({ profile: profileInput('apple\nbanana\ncherry'), suggestions: [], source: 'remote' });
  });

  it('rejects remote picks contradicted by the input profile', async () => {
    const inputs: [string, string, string][] = [
      ['Hello, world', 'split-columns', 'not delimited data'],
      ['0123456789abcdef0123456789abcdef', 'base64', 'not readable Base64'],
      ['{"a":1}\n{"b":2}', 'json-format', 'JSON Lines'],
    ];
    for (const [input, tool, issue] of inputs) {
      let called = false;
      const r = await route(input, { router: { rank: async () => ((called = true), [{ tool, score: 0.99, reason: 'model guess' }]) } });
      expect(r.suggestions.map((s) => s.tool), input).not.toContain(tool);
      if (called) expect(r.issues?.join(' '), input).toContain(issue);
      else expect(r).toMatchObject({ source: 'local', suggestions: [] });
    }
  });

  it('falls back to local on remote error', async () => {
    const r = await route('a@x.com b@y.com', { router: { rank: async () => { throw new Error('down'); } } });
    expect(r.source).toBe('local');
    expect(r.fallbackReason).toBe('down');
    expect(r.suggestions[0]!.tool).toBe('extract-emails');
  });
  it('falls back on timeout', async () => {
    const r = await route('a@x.com', {
      timeoutMs: 20,
      router: { rank: (_i, signal) => new Promise((_, rej) => (signal as any).addEventListener?.('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))) },
    });
    expect(r.source).toBe('local');
    expect(r.fallbackReason).toBe('timeout');
  });
  it('times out a router that ignores the abort signal', async () => {
    const t = performance.now();
    const r = await route('a@x.com', {
      timeoutMs: 30,
      router: { rank: () => new Promise((resolve) => setTimeout(() => resolve([]), 500)) },
    });
    expect(r.source).toBe('local');
    expect(r.fallbackReason).toBe('timeout');
    expect(performance.now() - t).toBeLessThan(300);
  });
  it('ignores unknown tools from remote', async () => {
    const r = await route('a@x.com', { router: { rank: async () => [{ tool: 'rm-rf', score: 1, reason: 'x' }] } });
    expect(r.source).toBe('local');
  });
  it('falls back when the router does not return an array', async () => {
    const r = await route('a@x.com', { router: { rank: async () => ({ tool: 'base64' }) as any } });
    expect(r).toMatchObject({ source: 'local', fallbackReason: 'remote returned no usable suggestions' });
    expect(r.issues).toEqual(['remote did not return an array']);
  });
});

describe('router contract', () => {
  it('keeps every locally fitting tool eligible on its sample inputs', async () => {
    for (const t of TOOLS.filter((x) => x.suggest)) {
      for (const input of t.input.examples) {
        let req: RouterRequest | undefined;
        await route(input, { router: { rank: async (q) => ((req = q), []) } });
        expect(req?.eligible, `${t.id}: ${input}`).toContain(t.id);
      }
    }
  });
  const capture = async (input: string, answer: unknown = []) => {
    let req: RouterRequest | undefined;
    const r = await route(input, { router: { rank: async (q) => ((req = q), answer as any) } });
    return { r, req };
  };
  it('sends the profile, the local candidates and the whole catalog, never raw text', async () => {
    // Tokens that appear nowhere in the static catalog, so a hit can only be a leak from the input.
    const secret = 'SuperSecretToken123';
    const { req } = await capture(`user|${secret}|zq9@leak-check.test\nuser|x|b@leak-check.test`);
    expect(req!.catalog).toEqual(routerCatalog());
    expect(req!.catalog.tools.map((t) => t.id)).toEqual(listTools().map((t) => t.id));
    expect(Object.keys(req!.catalog.fields).sort()).toEqual(Object.keys(req!.profile).sort());
    expect(req!.candidates.map((s) => s.tool)).toContain('split-columns');
    expect(req!.eligible).toContain('split-columns');
    expect(JSON.stringify(req)).not.toContain(secret);
    expect(JSON.stringify(req)).not.toContain('leak-check');
  });
  it('passes a bounded intent without sending raw text', async () => {
    let req: RouterRequest | undefined;
    const input = 'visit https://example.com/a';
    await route(input, { intent: { operation: 'extract', target: 'domains' }, router: { rank: async (q) => ((req = q), []) } });
    expect(req!.intent).toEqual({ operation: 'extract', target: 'domains' });
    expect(req!.eligible).toEqual(['extract-domains']);
    expect(JSON.stringify(req)).not.toContain(input);
    await expect(route(input, { intent: { operation: 'extract', target: input } as any, router: { rank: async () => [] } })).rejects.toMatchObject({ code: 'INVALID_OPTION' });
  });
  it('keeps suggestions aligned with a fully specified intent', async () => {
    const input = 'visit https://shop.example.com/a';
    const intent = { operation: 'extract', target: 'domains' } as const;
    let req: RouterRequest | undefined;
    const r = await route(input, { intent, router: { rank: async (q) => ((req = q), [
      { tool: 'extract-urls', score: 0.99, reason: 'wrong target' },
      { tool: 'extract-domains', score: 0.7, reason: 'requested target' },
    ]) } });
    expect(req!.candidates.map((s) => s.tool)).toEqual(['extract-domains']);
    expect(r.suggestions.map((s) => s.tool)).toEqual(['extract-domains']);
    expect(r.issues?.join(' ')).toContain('conflicts with requested intent');
    const fallback = await route(input, { intent, router: { rank: async () => [{ tool: 'extract-urls', score: 0.99, reason: 'wrong target' }] } });
    expect(fallback).toMatchObject({ source: 'local', suggestions: [{ tool: 'extract-domains' }] });
  });
  it('lets an explicit intent override a shape-only veto', async () => {
    const r = await route('plain text', {
      intent: { operation: 'encode', target: 'base64' },
      router: { rank: async () => [{ tool: 'base64', score: 0.9, reason: 'encode requested' }] },
    });
    expect(r).toMatchObject({ source: 'remote', suggestions: [{ tool: 'base64', options: { direction: 'encode' } }] });
  });
  it('does not treat JSON Lines as one document even with a formatting intent', async () => {
    let called = false;
    const r = await route('{"a":1}\n{"b":2}', {
      intent: { operation: 'format', target: 'json' },
      router: { rank: async () => ((called = true), [{ tool: 'json-format', score: 0.9, reason: 'format requested' }]) },
    });
    expect(r.suggestions.map((s) => s.tool)).not.toContain('json-format');
    expect(called).toBe(false);
  });
  it('asks the router when local finds nothing, and accepts a tool outside the candidates', async () => {
    const { r, req } = await capture('q=a%20b', [{ tool: 'url-encode', score: 0.7, reason: 'one percent sequence' }]);
    expect(req!.candidates).toEqual([]);
    expect(req!.eligible).toContain('url-encode');
    expect(r).toMatchObject({ source: 'remote', suggestions: [{ tool: 'url-encode', score: 0.7 }] });
    expect(r.issues).toBeUndefined();
  });
  it('does not ask the router for empty input', async () => {
    const { r, req } = await capture('');
    expect(req).toBeUndefined();
    expect(r).toEqual({ profile: profileInput(''), suggestions: [], source: 'local' });
  });
  it('does not ask the router when code finds no eligible tool', async () => {
    let called = false;
    const r = await route('hello', { router: { rank: async () => ((called = true), []) } });
    expect(called).toBe(false);
    expect(r).toMatchObject({ source: 'local', suggestions: [] });
  });
  it('keeps only well-formed remote suggestions and reports what it dropped or changed', async () => {
    const { r } = await capture('a@x.com,b@y.com\nc@z.com,d@w.com', [
      { tool: 'extract-emails', score: 7, reason: 'x'.repeat(500) },
      { tool: 'extract-emails', score: 0.5, reason: 'again' },
      { tool: 'base64', score: 'high', reason: 'bad score' },
      { tool: 'extract-domains', score: 0.4, reason: 'bad options', options: { nope: 1 } },
      { tool: 'select-columns', score: 0.6, reason: 'user picks columns', options: { delimiter: 'comma' } },
      { tool: 'clean-lines', score: 0.3 },
      null,
      { tool: 'rm-rf', score: 1, reason: 'x' },
    ]);
    expect(r.source).toBe('remote');
    expect(r.suggestions.map((s) => [s.tool, s.score])).toEqual([['extract-emails', 1], ['select-columns', 0.6], ['extract-domains', 0.4]]);
    expect(r.suggestions[0]!.reason).toHaveLength(200);
    expect(r.suggestions[1]!.options).toEqual({ delimiter: 'comma' });
    expect(r.suggestions[2]!.options).toBeUndefined();
    expect(r.issues).toEqual([
      'extract-emails: score 7 clamped to 1',
      'extract-emails: reason cut to 200 chars',
      'extract-emails: listed twice, kept the first',
      'base64: score is not a finite number',
      'extract-domains: options dropped (Unknown option "nope" for "extract-domains")',
      'clean-lines: no detected cleanup signal',
      'entry 6: not an object',
      'rm-rf: unknown tool',
    ]);
  });
  it('catalog version is a stable hash', () => {
    expect(routerCatalog().version).toMatch(/^[0-9a-f]{8}$/);
    expect(routerCatalog()).toBe(routerCatalog());
  });
});

// One prompt, one response format, one parser: Jev, Claude, GPT, Gemini or a local model rank the same way.
describe('any LLM as the router', () => {
  const secret = 'SuperSecretToken123';
  const request = async (input: string) => {
    let req: RouterRequest | undefined;
    await route(input, { router: { rank: async (q) => ((req = q), []) } });
    return req!;
  };
  it('the system prompt carries every field meaning and every input card', () => {
    const { system } = rankPrompt(routerCatalog());
    for (const [k, v] of Object.entries(PROFILE_FIELDS)) expect(system).toContain(`- ${k}: ${v}`);
    for (const t of listTools()) {
      expect(system).toContain(`## ${t.id} (${t.category})`);
      expect(system).toContain(`Use when: ${t.input.accepts}`);
      if (t.input.avoid) expect(system).toContain(`Not for: ${t.input.avoid}`);
      for (const [k, v] of Object.entries(t.input.signals)) expect(system).toContain(`${k} ${v}`);
      for (const o of Object.keys(t.options.properties)) expect(system, `${t.id}.${o}`).toContain(`  - ${o} (`);
    }
    expect(rankPrompt(routerCatalog()).system).toBe(system);
  });
  it('the user message is the profile + candidates (tool, score) as JSON, and nothing reaches the prompt from the text', async () => {
    const req = await request(`user|${secret}|zq9@leak-check.test\nuser|x|b@leak-check.test`);
    const p = rankPrompt(req.catalog, req);
    expect(JSON.parse(p.user!)).toEqual({ profile: req.profile, eligible: req.eligible, candidates: req.candidates.map(({ tool, score }) => ({ tool, score })) });
    expect(p.version).toBe(routerCatalog().version);
    for (const part of [p.system, p.user!]) {
      expect(part).not.toContain(secret);
      expect(part).not.toContain('leak-check');
    }
    const withIntent = rankPrompt(req.catalog, { ...req, intent: { operation: 'extract', target: 'domains' } });
    expect(JSON.parse(withIntent.user!).intent).toEqual({ operation: 'extract', target: 'domains' });
  });
  it('the response schema only allows catalog tools', () => {
    const items = (rankResponseSchema().properties.suggestions as any).items;
    expect(items.properties.tool.enum).toEqual(listTools().map((t) => t.id));
    expect(items.required).toEqual(['tool', 'score', 'reason']);
    const narrow = (rankResponseSchema(routerCatalog(), ['extract-domains']).properties.suggestions as any).items;
    expect(narrow.properties.tool.enum).toEqual(['extract-domains']);
  });
  it('parses what models really send back', () => {
    const want = [{ tool: 'extract-ip', score: 0.9, reason: 'r' }];
    const json = JSON.stringify({ suggestions: want });
    for (const reply of [json, JSON.stringify(want), '```json\n' + json + '\n```', `Here you go:\n${json}\nHope it helps.`, `\`\`\`\n${JSON.stringify(want)}\n\`\`\``]) {
      expect(parseRankResponse(reply), reply).toEqual(want);
    }
    for (const bad of ['', 'no idea', '{"tool":"x"}', '{"suggestions": 3}', '[1, 2']) expect(() => parseRankResponse(bad), bad).toThrowError(/not a ranking/);
  });
  it('llmRouter plugs any completion function into route()', async () => {
    let seen: RankPrompt | undefined;
    const router = llmRouter(async (prompt) => {
      seen = prompt;
      return '```json\n{"suggestions":[{"tool":"filter-lines","score":0.8,"reason":"log lines"}]}\n```';
    });
    const r = await route('2026-11-07 10:00:01 ERROR db\n2026-11-07 10:00:02 INFO ok', { intent: { operation: 'filter', target: 'lines' }, router });
    expect(r).toMatchObject({ source: 'remote', suggestions: [{ tool: 'filter-lines', score: 0.8 }] });
    expect(seen!.system).toBe(rankPrompt(routerCatalog()).system);
    expect(JSON.parse(seen!.user!).profile).toEqual(r.profile);
  });
  it('a reply that is not a ranking falls back to local', async () => {
    const r = await route('a@x.com', { router: llmRouter(async () => 'Sorry, I cannot help with that.') });
    expect(r.source).toBe('local');
    expect(r.fallbackReason).toMatch(/not a ranking/);
    expect(r.suggestions[0]!.tool).toBe('extract-emails');
  });
});

describe('AI adapters', () => {
  it('openai + anthropic schemas have valid names', () => {
    for (const t of [...openAITools().map((x) => x.function.name), ...anthropicTools().map((x) => x.name)]) {
      expect(t).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    }
  });
  it('descriptions tell the model when to use each tool', () => {
    for (const t of listTools()) {
      const d = modelDescription(t);
      expect(d).toContain(t.description);
      expect(d).toContain(`Use when: ${t.input.accepts}`);
      if (t.input.avoid) expect(d).toContain(`Not for: ${t.input.avoid}`);
      expect(d.length, t.id).toBeLessThanOrEqual(1024);
    }
    expect(openAITools()[0]!.function.description).toBe(modelDescription(listTools()[0]!));
    expect(anthropicTools()[0]!.description).toBe(modelDescription(listTools()[0]!));
  });
  it('handleToolCall never throws', () => {
    expect(handleToolCall('ptext_extract_emails', '{"input":"a@x.com"}')).toMatchObject({ ok: true, output: 'a@x.com' });
    expect(handleToolCall('ptext_nope', { input: 'x' })).toMatchObject({ ok: false, error: { code: 'UNKNOWN_TOOL' } });
    expect(handleToolCall('ptext_base64', 'not json')).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });
});

describe('errors', () => {
  it('errorToJSON maps non-PText errors to INTERNAL', () => {
    expect(errorToJSON(new TypeError('boom'))).toEqual({ code: 'INTERNAL', message: 'boom' });
    expect(errorToJSON(new PTextError('INVALID_INPUT', 'bad', { line: 2 }))).toEqual({ code: 'INVALID_INPUT', message: 'bad', details: { line: 2 } });
  });
});

describe('regex safety (filter-lines)', () => {
  const run = (pattern: string) => () => runTool('filter-lines', 'aaaa', { mode: 'regex', pattern });
  it('rejects nested repeats', () => {
    for (const p of ['(a+)+', '(\\w*)*$', '(?:x|y+){2,}', '((ab)+)+', '(a{1,3})*', '(?<n>\\d+)+']) {
      expect(run(p), p).toThrowError(expect.objectContaining({ code: 'INVALID_OPTION', details: expect.objectContaining({ reason: 'NESTED_QUANTIFIER' }) }));
    }
  });
  it('accepts single-level repeats and escapes that look like quantifiers', () => {
    for (const p of ['(foo|bar)+', 'a+b*', '(a{2})+', '[(+)]+', '\\(a+\\)+', '\\p{L}+', '^\\u{1F600}+$', '(?=a+)a', '(ab){3}']) expect(run(p), p).not.toThrow();
  });
  it('rejected pattern would otherwise be slow', () => {
    const t = performance.now();
    expect(() => runTool('filter-lines', 'a'.repeat(40) + '!', { mode: 'regex', pattern: '^(a+)+$' })).toThrow(PTextError);
    expect(performance.now() - t).toBeLessThan(100);
  });
});

describe('limits', () => {
  it('rejects oversized input', () => {
    expect(() => runTool('clean-lines', 'x'.repeat(11), {}, { limits: { maxInputChars: 10 } })).toThrowError(/limit/);
  });
  it('handles 1MB input quickly', () => {
    const big = Array.from({ length: 50_000 }, (_, i) => `user${i % 1000}@example.com some text`).join('\n');
    const t = performance.now();
    const r = runTool('extract-emails', big);
    expect(r.data).toHaveLength(1000);
    expect(performance.now() - t).toBeLessThan(2000);
  });
  it('column tools handle 400k rows', () => {
    const rows = 'a,b\n'.repeat(400_000);
    expect(runTool('split-columns', rows).stats.count).toBe(2);
    expect(runTool('select-columns', rows, { columns: '2' }).stats.outputLines).toBe(400_000);
  });
});

describe('profiler scores', () => {
  it('are rounded (no float noise)', () => {
    for (const s of suggestTools('a\nb\na\nb\nc').suggestions) expect(String(s.score).length).toBeLessThanOrEqual(5);
  });
});
