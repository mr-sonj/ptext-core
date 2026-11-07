import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createPTextServer, type PTextServerOptions } from './server.js';

export interface FetchHandlerOptions extends PTextServerOptions {
  /** Path the MCP endpoint is served on. Default "/mcp". */
  path?: string;
}

/**
 * `(Request) => Promise<Response>` for any Web-standard runtime:
 * Cloudflare Workers, Deno, Bun, Node (via adapters), Vercel/Netlify edge.
 * Stateless: a fresh server+transport per request (no session store needed).
 */
export function createFetchHandler(opts: FetchHandlerOptions = {}) {
  const path = opts.path ?? '/mcp';
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== path) return new Response('Not found', { status: 404 });
    const server = createPTextServer(opts);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  };
}
