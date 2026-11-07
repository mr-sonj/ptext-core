import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { jsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/types.js';
import {
  listTools,
  runTool,
  suggestTools,
  toolInputSchema,
  modelDescription,
  routerCatalog,
  toolName,
  toolIdFromName,
  errorToJSON,
  PTextError,
  VERSION,
  type Limits,
} from '@ptext/core';

export interface PTextServerOptions {
  limits?: Partial<Limits>;
  /** Max chars of `output` returned inline to the model (rest truncated with a notice). */
  maxOutputChars?: number;
  /** Pass a Workers-safe validator (e.g. CfWorkerJsonSchemaValidator) on edge runtimes. */
  jsonSchemaValidator?: jsonSchemaValidator;
}

const SUGGEST = 'ptext_suggest';
const CATALOG = 'ptext_catalog';

/** Cut at `max` UTF-16 units without leaving half of a surrogate pair (an emoji) at the end. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

/** The low-level Server does not validate `inputSchema`, so check `limit` here. */
function suggestLimit(raw: unknown): number {
  if (raw === undefined) return 5;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > 10) {
    throw new PTextError('INVALID_OPTION', '"limit" must be an integer from 1 to 10', { option: 'limit' });
  }
  return raw;
}

/**
 * Build an MCP Server exposing every PText tool + `ptext_suggest` + `ptext_catalog`.
 * Transport-agnostic: connect it to stdio (local) or Web-standard Streamable HTTP (Workers/Deno/Bun).
 * Uses the low-level Server with plain JSON Schema → no zod needed.
 */
export function createPTextServer(opts: PTextServerOptions = {}): Server {
  const maxOut = opts.maxOutputChars ?? 100_000;
  const server = new Server(
    { name: 'ptext', version: VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        'PText: deterministic text tools. Each tool description says when to use it. Call ptext_suggest with a sample when unsure which tool fits, then call the tool. ptext_catalog explains every profile field and the signals that point to each tool. Results are computed by code, not by an LLM.',
      ...(opts.jsonSchemaValidator ? { jsonSchemaValidator: opts.jsonSchemaValidator } : {}),
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: SUGGEST,
        description: 'Profile a text sample locally and suggest the best PText tools (with options). Raw text never leaves this process.',
        inputSchema: {
          type: 'object',
          properties: {
            input: { type: 'string', description: 'Text (or a representative sample) to analyse.' },
            limit: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
          },
          required: ['input'],
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      {
        name: CATALOG,
        description:
          'Every PText tool with its input card (when to use it, the profile signals that point to it, look-alikes, examples, options) and the meaning of each profile field that ptext_suggest returns. Static; call it once.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      },
      ...listTools().map((t) => ({
        name: toolName(t.id),
        title: t.title,
        description: modelDescription(t),
        inputSchema: toolInputSchema(t),
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      })),
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name } = req.params;
    const args = (req.params.arguments ?? {}) as { input?: unknown; options?: unknown; limit?: unknown };
    try {
      if (name === CATALOG) {
        const catalog = routerCatalog();
        return { content: [{ type: 'text', text: JSON.stringify(catalog) }], structuredContent: catalog as unknown as Record<string, unknown> };
      }
      if (typeof args.input !== 'string') throw new PTextError('INVALID_INPUT', '"input" (string) is required');
      if (name === SUGGEST) {
        const res = suggestTools(args.input, suggestLimit(args.limit));
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], structuredContent: res as unknown as Record<string, unknown> };
      }
      const r = runTool(toolIdFromName(name), args.input, args.options, opts.limits ? { limits: opts.limits } : {});
      const text = truncate(r.output, maxOut);
      const truncated = text.length < r.output.length;
      const meta = { tool: r.tool, stats: r.stats, warnings: r.warnings, ...(truncated ? { truncated: true, fullLength: r.output.length } : {}) };
      return {
        content: [
          { type: 'text', text },
          { type: 'text', text: `--- ptext meta ---\n${JSON.stringify(meta)}` },
        ],
        structuredContent: meta as unknown as Record<string, unknown>,
      };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(errorToJSON(e)) }] };
    }
  });

  return server;
}
