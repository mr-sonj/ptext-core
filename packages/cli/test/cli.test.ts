import { describe, expect, it } from 'vitest';
import { JEV_MODEL, jevQuestions, listTools, rankPrompt, rankResponseSchema, routerCatalog } from '@ptext/core';
import { runCli } from '../src/run.js';

const cli = (argv: string[], stdin = '') => runCli(argv, async () => stdin);

describe('ptext CLI', () => {
  it('list prints the catalog', async () => {
    const r = await cli(['list']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toHaveLength(listTools().length);
  });

  it('catalog prints the router catalog (fields + tools with input cards)', async () => {
    const r = await cli(['catalog']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(routerCatalog());
  });

  it('jev prints the static part of a Jev request', async () => {
    const r = await cli(['jev']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ version: routerCatalog().version, model: JEV_MODEL, questions: jevQuestions() });
  });

  it('prompt prints the ranking prompt and response schema for any LLM', async () => {
    const r = await cli(['prompt']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ ...rankPrompt(routerCatalog()), responseSchema: rankResponseSchema() });
  });

  it('run prints output and sends warnings to stderr', async () => {
    expect(await cli(['run', 'extract-emails'], 'hi a@x.com')).toEqual({ code: 0, stdout: 'a@x.com\n', stderr: '' });
    const r = await cli(['run', 'extract-emails'], 'nothing here');
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('warning NO_MATCH');
  });

  it('run passes --flags as options and --json wraps the result', async () => {
    const r = await cli(['run', 'select-columns', '--columns=2', '--json'], 'a|b\nc|d');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, output: 'b\nd' });
  });

  it('exit 2 for usage and option errors', async () => {
    expect((await cli(['run', 'nope'], 'x')).code).toBe(2);
    expect((await cli(['run', 'filter-lines'], 'x')).code).toBe(2);
    expect((await cli(['frobnicate'])).code).toBe(2);
    expect((await cli([])).code).toBe(0);
  });

  it('exit 3 for invalid input', async () => {
    expect((await cli(['run', 'base64'], '@@@')).code).toBe(3);
  });

  it('exec: JSON in, JSON out', async () => {
    const r = await cli(['exec'], '{"tool":"base64","input":"aGk="}');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, output: 'hi' });
  });

  it('exec: malformed JSON or a missing field is invalid input (exit 3), not INTERNAL', async () => {
    for (const stdin of ['not json', '{"input":"x"}', 'null']) {
      const r = await cli(['exec'], stdin);
      expect(r.code, stdin).toBe(3);
      expect(JSON.parse(r.stdout), stdin).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    }
  });
});
