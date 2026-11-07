#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createPTextServer } from './server.js';

const server = createPTextServer();
await server.connect(new StdioServerTransport());
// stdout is reserved for JSON-RPC; log to stderr only.
console.error('[ptext-mcp] ready on stdio');
