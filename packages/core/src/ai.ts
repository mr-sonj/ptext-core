import { listTools, runTool } from './registry.js';
import { PTextError, errorToJSON, type ToolInfo } from './types.js';

/** JSON Schema of a tool call input: { input, options }. Shared by all adapters. */
export function toolInputSchema(t: ToolInfo) {
  return {
    type: 'object' as const,
    properties: {
      input: { type: 'string', description: 'The raw text to process.' },
      options: t.options,
    },
    required: ['input'],
    additionalProperties: false,
  };
}

/** Tool names safe for every provider (^[a-zA-Z0-9_-]{1,64}$). */
export const toolName = (id: string) => `ptext_${id.replace(/-/g, '_')}`;
export const toolIdFromName = (name: string) => name.replace(/^ptext_/, '').replace(/_/g, '-');

/** What a model reads to pick the tool: what it does, when the input fits, and the look-alike to avoid. */
export function modelDescription(t: ToolInfo): string {
  return [t.description, `Use when: ${t.input.accepts}`, t.input.avoid ? `Not for: ${t.input.avoid}` : ''].filter(Boolean).join(' ');
}

/** OpenAI Chat Completions / Responses `tools` format. */
export function openAITools() {
  return listTools().map((t) => ({
    type: 'function' as const,
    function: { name: toolName(t.id), description: modelDescription(t), parameters: toolInputSchema(t) },
  }));
}

/** Anthropic Messages API `tools` format. */
export function anthropicTools() {
  return listTools().map((t) => ({ name: toolName(t.id), description: modelDescription(t), input_schema: toolInputSchema(t) }));
}

/** Malformed arguments from a model are bad input, not a PText bug. */
function parseArgs(args: string): unknown {
  try {
    return JSON.parse(args);
  } catch (e) {
    throw new PTextError('INVALID_INPUT', `Tool arguments are not valid JSON: ${(e as Error).message}`);
  }
}

/**
 * Execute a tool call coming back from any LLM. Never throws: returns a
 * JSON-serializable object so it can be fed straight back to the model.
 */
export function handleToolCall(name: string, args: unknown): Record<string, unknown> {
  try {
    const a = (typeof args === 'string' ? parseArgs(args) : args) as { input?: unknown; options?: unknown };
    if (!a || typeof a.input !== 'string') throw new PTextError('INVALID_INPUT', '"input" (string) is required');
    const r = runTool(toolIdFromName(name), a.input, a.options);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: errorToJSON(e) };
  }
}
