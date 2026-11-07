/** JSON Schema subset used by PText tool options (portable to MCP / OpenAI / Anthropic). */
export interface OptionSchema {
  type: 'string' | 'integer' | 'number' | 'boolean';
  description: string;
  enum?: readonly (string | number)[];
  default?: string | number | boolean;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}

export interface OptionsSchema {
  type: 'object';
  properties: Record<string, OptionSchema>;
  required?: readonly string[];
  additionalProperties: false;
}

/** Catalog order. `pnpm new-tool` only accepts these; add a category here first. */
export const TOOL_CATEGORIES = ['extract', 'clean', 'columns', 'convert', 'encode', 'format'] as const;

export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

export interface ToolWarning {
  code: string;
  message: string;
  /** 1-based line number when the warning is tied to a line. */
  line?: number;
}

export interface ToolStats {
  inputLines: number;
  outputLines: number;
  /** Number of items produced (matches, rows, ...) when meaningful. */
  count?: number;
  /** Number of input items dropped/changed, when meaningful. */
  removed?: number;
}

export interface ToolResult<D = unknown> {
  tool: string;
  /** Primary text output, ready to copy/download. */
  output: string;
  /** Structured output (list, rows, objects) when meaningful. */
  data?: D;
  stats: ToolStats;
  warnings: ToolWarning[];
}

export interface ToolContext {
  limits: Limits;
}

/**
 * Non-sensitive signals describing an input. Contains ONLY counts/ratios/flags,
 * never raw text — safe to forward to an optional remote router (e.g. Jev).
 * What each field means exactly: `PROFILE_FIELDS` in profiler.ts.
 */
export interface InputProfile {
  chars: number;
  lines: number;
  nonEmptyLines: number;
  duplicateLineRatio: number;
  emptyLineRatio: number;
  emailCount: number;
  urlCount: number;
  hostnameCount: number;
  ipv4Count: number;
  ipv6Count: number;
  delimiter: 'tab' | 'comma' | 'pipe' | 'semicolon' | 'colon' | null;
  columnCount: number;
  looksLikeJson: boolean;
  jsonValid: boolean;
  jsonLines: boolean;
  looksLikeBase64: boolean;
  base64DecodesToText: boolean;
  percentEncodedCount: number;
  hasInvisibleChars: boolean;
  hasTrailingSpaces: boolean;
}

/**
 * When to pick a tool, as data: it goes with the catalog to AI clients and to the remote router.
 * `signals` names exactly the profile fields the tool's `suggest` reads (a test checks it).
 */
export interface ToolInputSpec {
  /** One sentence: what the pasted text looks like when this tool fits. */
  accepts: string;
  /** Profile field → the value that points to this tool. Empty for a tool that is never auto-suggested. */
  signals: Partial<Record<keyof InputProfile, string>>;
  /** The look-alike case, and the tool to pick instead. */
  avoid?: string;
  /** 1–3 short sample inputs. For a suggested tool, each one fires its rule and ranks it top-3. */
  examples: readonly string[];
}

export interface Suggestion {
  tool: string;
  score: number;
  reason: string;
  options?: Record<string, unknown>;
}

/** What a tool's `suggest` rule returns: how well it fits (0–1), why, and the options to run it with. */
export type ToolFit = Omit<Suggestion, 'tool'>;

export interface ToolDefinition<O = Record<string, unknown>> {
  id: string;
  title: string;
  description: string;
  category: ToolCategory;
  options: OptionsSchema;
  input: ToolInputSpec;
  run(input: string, options: O, ctx: ToolContext): Omit<ToolResult, 'tool'>;
  /** Local suggestion rule. Return null when the profile does not fit. Omit for tools that are never auto-suggested. */
  suggest?(profile: InputProfile): ToolFit | null;
}

/** Public, serializable description of a tool (no functions). */
export interface ToolInfo {
  id: string;
  title: string;
  description: string;
  category: ToolCategory;
  options: OptionsSchema;
  input: ToolInputSpec;
}

export interface Limits {
  /** Max input length in UTF-16 code units. */
  maxInputChars: number;
  /** Max length of a user-provided regex pattern. */
  maxPatternLength: number;
}

export const DEFAULT_LIMITS: Limits = Object.freeze({
  maxInputChars: 5_000_000,
  maxPatternLength: 500,
});

export type ErrorCode =
  | 'UNKNOWN_TOOL'
  | 'INVALID_OPTION'
  | 'INVALID_INPUT'
  | 'INPUT_TOO_LARGE'
  /** A bug, not bad input. Only produced by `errorToJSON` for errors that are not a `PTextError`. */
  | 'INTERNAL';

export class PTextError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'PTextError';
    this.code = code;
    if (details) this.details = details;
  }
  toJSON(): ErrorJSON {
    return { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) };
  }
}

export interface ErrorJSON {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/** Serialize any thrown value. Every adapter (AI, MCP, CLI, HTTP) uses this so error shapes stay identical. */
export function errorToJSON(e: unknown): ErrorJSON {
  if (e instanceof PTextError) return e.toJSON();
  return { code: 'INTERNAL', message: e instanceof Error ? e.message : String(e) };
}
