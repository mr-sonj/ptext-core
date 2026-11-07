import { JEV_MODEL, jevQuestions, listTools, rankPrompt, rankResponseSchema, routerCatalog, runTool, suggestTools, errorToJSON, PTextError, VERSION } from '@ptext/core';

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

const USAGE = 'Usage: ptext <list|catalog|prompt|jev|suggest|run <tool>|exec> [--option=value] [--json]\nSee: ptext list';

function parseFlags(args: string[]) {
  const opts: Record<string, string | boolean> = {};
  const pos: string[] = [];
  for (const a of args) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) opts[m[1]!] = m[2] ?? true;
    else pos.push(a);
  }
  return { opts, pos };
}

/** `exec` reads a JSON request; malformed JSON is bad input (exit 3), not a crash. */
function parseRequest(raw: string): { tool: string; input: string; options?: unknown } {
  let req: unknown;
  try {
    req = JSON.parse(raw);
  } catch (e) {
    throw new PTextError('INVALID_INPUT', `stdin is not valid JSON: ${(e as Error).message}`);
  }
  const r = req as { tool?: unknown; input?: unknown; options?: unknown } | null;
  if (!r || typeof r !== 'object' || typeof r.tool !== 'string' || typeof r.input !== 'string') {
    throw new PTextError('INVALID_INPUT', 'Expected {"tool": string, "input": string, "options"?: object}');
  }
  return r as { tool: string; input: string; options?: unknown };
}

const line = (s: string) => (s.endsWith('\n') ? s : s + '\n');

/**
 * The whole CLI as a pure function, so it can be tested in-process.
 * Exit codes: 0 ok · 2 usage/option error · 3 invalid input · 1 internal.
 */
export async function runCli(argv: string[], readStdin: () => Promise<string>): Promise<CliResult> {
  const [cmd, ...rest] = argv;
  const { opts, pos } = parseFlags(rest);
  const json = opts.json === true || cmd === 'exec';
  delete opts.json;
  let stderr = '';
  const ok = (s: string): CliResult => ({ code: 0, stdout: line(s), stderr });

  try {
    switch (cmd) {
      case 'list':
        return ok(JSON.stringify(listTools(), null, 2));
      // What a remote router (Jev) ranks against: profile field meanings + every tool's input card.
      case 'catalog':
        return ok(JSON.stringify(routerCatalog(), null, 2));
      // The same ranking prompt for any LLM: system text + reply schema. The user message is JSON of { profile, candidates }.
      case 'prompt':
        return ok(JSON.stringify({ ...rankPrompt(routerCatalog()), responseSchema: rankResponseSchema() }, null, 2));
      // Jev (decision model): the static part of the request. A backend adds { state } and the key.
      case 'jev':
        return ok(JSON.stringify({ version: routerCatalog().version, model: JEV_MODEL, questions: jevQuestions() }, null, 2));
      case 'suggest':
        return ok(JSON.stringify(suggestTools(await readStdin()), null, 2));
      case 'run': {
        const tool = pos[0];
        if (!tool) throw new PTextError('INVALID_OPTION', 'Usage: ptext run <tool> [--option=value] [--json] < input');
        const r = runTool(tool, await readStdin(), opts);
        if (json) return ok(JSON.stringify({ ok: true, ...r }));
        for (const w of r.warnings) stderr += `ptext: warning ${w.code}: ${w.message}\n`;
        return ok(r.output);
      }
      case 'exec': {
        const req = parseRequest(await readStdin());
        return ok(JSON.stringify({ ok: true, ...runTool(req.tool, req.input, req.options) }));
      }
      case '--version':
      case '-v':
        return ok(VERSION);
      default:
        return { code: cmd ? 2 : 0, stdout: line(USAGE), stderr };
    }
  } catch (e) {
    const err = errorToJSON(e);
    const code = err.code === 'INTERNAL' ? 1 : err.code === 'INVALID_INPUT' || err.code === 'INPUT_TOO_LARGE' ? 3 : 2;
    if (json) return { code, stdout: line(JSON.stringify({ ok: false, error: err })), stderr };
    return { code, stdout: '', stderr: stderr + `ptext: ${err.code}: ${err.message}\n` };
  }
}
