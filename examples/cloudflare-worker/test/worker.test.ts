import { describe, expect, it } from 'vitest';
import { rankPrompt, rankResponseSchema, routerCatalog } from '@ptext/core';
import worker from '../src/index.js';

const post = (path: string, body: string) =>
  worker.fetch(new Request(`https://x.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body }));

describe('Worker REST endpoints', () => {
  it('run and suggest work', async () => {
    const run = await post('/api/run', JSON.stringify({ tool: 'extract-emails', input: 'a@x.com' }));
    expect(run.status).toBe(200);
    expect(await run.json()).toMatchObject({ ok: true, output: 'a@x.com' });
    const sug = await post('/api/suggest', JSON.stringify({ input: 'a@x.com b@y.com' }));
    expect(((await sug.json()) as any).suggestions[0].tool).toBe('extract-emails');
  });

  it('GET /api/catalog and /api/prompt serve the same catalog and prompt as core', async () => {
    const get = (path: string) => worker.fetch(new Request(`https://x.test${path}`));
    expect(await (await get('/api/catalog')).json()).toEqual(routerCatalog());
    expect(await (await get('/api/prompt')).json()).toEqual({ ...rankPrompt(routerCatalog()), responseSchema: rankResponseSchema() });
  });

  it('caps /api/suggest like /api/run', async () => {
    const big = JSON.stringify({ input: 'x'.repeat(1_000_001) });
    for (const path of ['/api/run', '/api/suggest']) {
      const r = await post(path, big);
      expect(r.status, path).toBe(400);
      expect(((await r.json()) as any).error.code, path).toBe('INPUT_TOO_LARGE');
    }
  });

  it('bad bodies are 400 INVALID_INPUT, not 500', async () => {
    for (const body of ['not json', '{}', '{"input":3}']) {
      const r = await post('/api/suggest', body);
      expect(r.status, body).toBe(400);
      expect(((await r.json()) as any).error.code, body).toBe('INVALID_INPUT');
    }
  });

  it('unknown tool is 400 UNKNOWN_TOOL', async () => {
    const r = await post('/api/run', JSON.stringify({ tool: 'nope', input: 'x' }));
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error.code).toBe('UNKNOWN_TOOL');
  });
});
