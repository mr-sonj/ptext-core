import { DEFAULT_LIMITS, PTextError, TOOL_CATEGORIES, type Limits, type ToolDefinition, type ToolInfo, type ToolResult } from './types.js';
import { validateOptions } from './lib/options.js';
import { TOOLS } from './tools/index.js';

/** Catalog order: by category, then registration order (Array#sort is stable). */
export const ALL = [...TOOLS].sort((a, b) => TOOL_CATEGORIES.indexOf(a.category) - TOOL_CATEGORIES.indexOf(b.category));
const BY_ID = new Map(ALL.map((t) => [t.id, t]));

const info = ({ id, title, description, category, options, input }: ToolDefinition<any>): ToolInfo => ({ id, title, description, category, options, input });

/** Serializable catalog (with each tool's input card) — safe to send to an LLM, an MCP client, a router or a web UI. */
export function listTools(): ToolInfo[] {
  return ALL.map(info);
}

export function getTool(id: string): ToolInfo | undefined {
  const t = BY_ID.get(id);
  return t && info(t);
}

export interface RunOptions {
  limits?: Partial<Limits>;
}

/**
 * Run a tool deterministically. Throws `PTextError` for unknown tools,
 * invalid options, invalid input or input that exceeds limits.
 */
export function runTool(id: string, input: string, options?: unknown, runOptions: RunOptions = {}): ToolResult {
  const tool = BY_ID.get(id);
  if (!tool) {
    throw new PTextError('UNKNOWN_TOOL', `Unknown tool "${id}"`, { available: [...BY_ID.keys()] });
  }
  if (typeof input !== 'string') throw new PTextError('INVALID_INPUT', 'Input must be a string');
  const limits: Limits = { ...DEFAULT_LIMITS, ...runOptions.limits };
  if (input.length > limits.maxInputChars) {
    throw new PTextError('INPUT_TOO_LARGE', `Input is ${input.length} chars; limit is ${limits.maxInputChars}`, {
      length: input.length,
      limit: limits.maxInputChars,
    });
  }
  const opts = validateOptions(id, tool.options, options);
  return { tool: id, ...tool.run(input, opts, { limits }) };
}
