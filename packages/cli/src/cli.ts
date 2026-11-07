#!/usr/bin/env node
/**
 * ptext CLI — bridge for any language (PHP/Laravel, Python, shell).
 *
 *   ptext list                              # catalog as JSON (tools + input cards)
 *   ptext catalog                           # router catalog: profile field meanings + tools (any AI, Jev included)
 *   ptext prompt                            # ranking prompt (system text + reply schema) for any LLM
 *   ptext jev                               # Jev decision request: model + questions (add state + key)
 *   ptext suggest < input.txt               # local profile + suggestions (JSON)
 *   ptext run extract-emails < input.txt    # plain output
 *   ptext run select-columns --columns=3,1 --json < data.txt
 *   echo '{"tool":"base64","input":"aGk=","options":{}}' | ptext exec   # JSON in → JSON out
 *
 * Exit codes: 0 ok · 2 usage/option error · 3 invalid input · 1 internal.
 */
import { runCli } from './run.js';

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const r = await runCli(process.argv.slice(2), readStdin);
if (r.stderr) process.stderr.write(r.stderr);
if (r.stdout) process.stdout.write(r.stdout);
process.exitCode = r.code;
