/**
 * PText on Cloudflare Workers.
 *   POST /mcp            → MCP Streamable HTTP (stateless)
 *   GET  /api/tools      → tools with input cards
 *   GET  /api/catalog    → profile field meanings + tools (for any AI ranker)
 *   GET  /api/prompt     → ranking prompt (system text + reply schema) for any LLM
 *   POST /api/run        → { tool, input, options } → ToolResult
 *   POST /api/suggest    → { input } → { profile, suggestions }
 * Same @ptext/core as browser / Node / MCP stdio — zero code duplication.
 */
import { listTools, rankPrompt, rankResponseSchema, routerCatalog, runTool, suggestTools, errorToJSON, PTextError } from '@ptext/core';
import { createFetchHandler } from '@ptext/mcp';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';

/** Same cap for every endpoint; the core default (5M chars) is too much for a Worker's CPU budget. */
const MAX_INPUT_CHARS = 1_000_000;
const limits = { maxInputChars: MAX_INPUT_CHARS };

// Workers forbid eval/new Function → use the cfworker validator instead of Ajv.
const mcp = createFetchHandler({ path: '/mcp', jsonSchemaValidator: new CfWorkerJsonSchemaValidator(), limits });

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

/** Parse `{ input, ... }`; a bad body is the caller's error (400), not a Worker crash (500). */
async function readBody(request: Request): Promise<{ input: string; tool?: unknown; options?: unknown }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new PTextError('INVALID_INPUT', 'Body must be JSON');
  }
  const b = body as { input?: unknown } | null;
  if (!b || typeof b.input !== 'string') throw new PTextError('INVALID_INPUT', '"input" (string) is required');
  if (b.input.length > MAX_INPUT_CHARS) {
    throw new PTextError('INPUT_TOO_LARGE', `Input is ${b.input.length} chars; limit is ${MAX_INPUT_CHARS}`, { length: b.input.length, limit: MAX_INPUT_CHARS });
  }
  return b as { input: string; tool?: unknown; options?: unknown };
}

export default {
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === '/mcp') return await mcp(request);
      if (pathname === '/api/tools' && request.method === 'GET') return json(listTools());
      if (pathname === '/api/catalog' && request.method === 'GET') return json(routerCatalog());
      if (pathname === '/api/prompt' && request.method === 'GET') return json({ ...rankPrompt(routerCatalog()), responseSchema: rankResponseSchema() });
      if (pathname === '/api/run' && request.method === 'POST') {
        const { tool, input, options } = await readBody(request);
        return json({ ok: true, ...runTool(String(tool), input, options, { limits }) });
      }
      if (pathname === '/api/suggest' && request.method === 'POST') {
        const { input } = await readBody(request);
        return json(suggestTools(input));
      }
      return json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);
    } catch (e) {
      const error = errorToJSON(e);
      return json({ ok: false, error }, error.code === 'INTERNAL' ? 500 : 400);
    }
  },
};
