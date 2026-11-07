import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { listTools, modelDescription, routerCatalog, runTool, toolName } from '@ptext/core';
import { createPTextServer, createFetchHandler, type PTextServerOptions } from '@ptext/mcp';
import { loadGolden } from '../../../fixtures/load.js';

const golden = loadGolden();

async function connect(opts?: PTextServerOptions) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createPTextServer(opts);
  await server.connect(a);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(b);
  return client;
}

describe('MCP server', () => {
  it('lists every core tool + suggest', async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('ptext_suggest');
    for (const t of listTools()) expect(names).toContain(toolName(t.id));
  });

  it('ptext_catalog gives any MCP client the field meanings and every input card', async () => {
    const c = await connect();
    const res = (await c.callTool({ name: 'ptext_catalog', arguments: {} })) as any;
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(res.content[0].text)).toEqual(routerCatalog());
    expect(res.structuredContent).toEqual(routerCatalog());
  });

  it('tool descriptions carry the input card', async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    for (const t of listTools()) expect(tools.find((x) => x.name === toolName(t.id))!.description).toBe(modelDescription(t));
  });

  it('parity with core on golden fixtures', async () => {
    const c = await connect();
    for (const g of golden.filter((x) => !x.expectError)) {
      const res = (await c.callTool({ name: toolName(g.tool), arguments: { input: g.input, options: g.options } })) as any;
      expect(res.isError, g.name).toBeFalsy();
      expect(res.content[0].text, g.name).toBe(runTool(g.tool, g.input, g.options).output);
    }
  });

  it('returns isError for bad calls', async () => {
    const c = await connect();
    const res = (await c.callTool({ name: 'ptext_filter_lines', arguments: { input: 'x' } })) as any;
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('INVALID_OPTION');
  });

  it('errors carry the same code as core', async () => {
    const c = await connect();
    for (const g of golden.filter((x) => x.expectError)) {
      const res = (await c.callTool({ name: toolName(g.tool), arguments: { input: g.input, options: g.options } })) as any;
      expect(res.isError, g.name).toBe(true);
      expect(JSON.parse(res.content[0].text).code, g.name).toBe(g.expectError);
    }
  });

  it('suggest works', async () => {
    const c = await connect();
    const res = (await c.callTool({ name: 'ptext_suggest', arguments: { input: 'a@x.com, b@y.com' } })) as any;
    expect(JSON.parse(res.content[0].text).suggestions[0].tool).toBe('extract-emails');
  });

  it('suggest rejects a bad limit instead of dropping results', async () => {
    const c = await connect();
    for (const limit of [-1, 0, 11, 2.5, '3']) {
      const res = (await c.callTool({ name: 'ptext_suggest', arguments: { input: 'a@x.com', limit } })) as any;
      expect(res.isError, String(limit)).toBe(true);
      expect(JSON.parse(res.content[0].text).code).toBe('INVALID_OPTION');
    }
  });

  it('truncation never splits a surrogate pair', async () => {
    const c = await connect({ maxOutputChars: 3 });
    const res = (await c.callTool({ name: 'ptext_clean_lines', arguments: { input: 'ab😀cd' } })) as any;
    expect(res.content[0].text).toBe('ab');
    expect(res.structuredContent).toMatchObject({ truncated: true, fullLength: 6 });
  });
});

describe('Web-standard fetch handler (Workers/Deno/Bun)', () => {
  const handle = createFetchHandler();
  const rpc = (body: unknown) =>
    handle(
      new Request('https://x.test/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
        body: JSON.stringify(body),
      }),
    );

  it('404 on other paths', async () => {
    expect((await handle(new Request('https://x.test/'))).status).toBe(404);
  });

  it('initialize + tools/call over HTTP', async () => {
    const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
    expect(init.status).toBe(200);
    expect(((await init.json()) as any).result.serverInfo.name).toBe('ptext');

    const call = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ptext_extract_emails', arguments: { input: 'hi a@x.com' } } });
    const body = (await call.json()) as any;
    expect(body.result.content[0].text).toBe('a@x.com');
  });
});
