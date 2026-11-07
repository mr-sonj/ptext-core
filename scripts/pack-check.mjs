#!/usr/bin/env node
// Checks that the packages install and run the way the README tells people to use them:
// `npm install @ptext/core`, `npm install -g @ptext/cli` and `npx -y @ptext/mcp`.
//
//   node scripts/pack-check.mjs
//       Packs @ptext/core, @ptext/mcp and @ptext/cli from the workspace (run `pnpm build` first) as the npm job does,
//       checks each tarball, installs the three tarballs into an empty project with npm, then imports the library,
//       runs `ptext` and talks to `ptext-mcp` over stdio. CI runs it before a tag can become a release, so a version
//       that would not install never reaches GitHub releases or npm.
//
//   node scripts/pack-check.mjs --from-npm[=<version>]
//       The same checks against the npm registry, after publishing (default: the workspace version). Installs the
//       library, installs the CLI globally into a temporary prefix and starts the MCP server with `npx -y`. Waits a few
//       minutes for the registry to list the version.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACKAGES = ['core', 'mcp', 'cli'];
const EMAILS_IN = 'Mail a@x.com or b@y.io, again a@x.com\n';
const EMAILS_OUT = 'a@x.com\nb@y.io';

/** @type {string[]} */
const failures = [];
/** @param {string} label @param {boolean} pass @param {string} [detail] */
function check(label, pass, detail = '') {
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${pass || !detail ? '' : `: ${detail}`}`);
  if (!pass) failures.push(label);
}

/** @param {string} cmd @param {string[]} args @param {{ cwd?: string, input?: string }} [opts] */
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'], ...opts });

const npm = (/** @type {string[]} */ args, /** @type {string} */ cwd) => run('npm', [...args, '--no-audit', '--no-fund'], { cwd });

/** Packs one workspace package as the npm job does and checks what would be published. */
function packAndInspect(/** @type {string} */ p, /** @type {string} */ version, /** @type {string} */ dir) {
  run('pnpm', ['pack', '--pack-destination', dir], { cwd: join(ROOT, 'packages', p) });
  const tgz = join(dir, `ptext-${p}-${version}.tgz`);
  const out = join(dir, p);
  mkdirSync(out);
  run('tar', ['-xzf', tgz, '-C', out]);
  const pkgDir = join(out, 'package');
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  const name = `@ptext/${p}`;

  check(`${name}: version ${version}`, pkg.version === version, pkg.version);
  for (const [dep, range] of Object.entries(pkg.dependencies ?? {})) {
    // workspace:* must become the release version; any other spelling would install a different core.
    const want = dep.startsWith('@ptext/') ? range === version : !String(range).startsWith('workspace:');
    check(`${name}: dependency ${dep}@${range}`, want, `expected ${dep.startsWith('@ptext/') ? version : 'a registry range'}`);
  }
  const entry = pkg.exports?.['.'] ?? {};
  const bins = Object.values(pkg.bin ?? {});
  const files = ['README.md', 'LICENSE', pkg.main, pkg.types, entry.import, entry.types, ...bins].filter(Boolean);
  const missing = [...new Set(files)].filter((f) => !existsSync(join(pkgDir, f)));
  check(`${name}: README, LICENSE and entry points packed`, missing.length === 0, `missing ${missing.join(', ')}`);
  for (const b of bins.filter((f) => existsSync(join(pkgDir, f)))) {
    check(`${name}: ${b} starts with a node shebang`, readFileSync(join(pkgDir, b), 'utf8').startsWith('#!/usr/bin/env node\n'));
  }
  if (pkg.bin) {
    // `npx -y @ptext/<p>` runs the only bin, or the one named after the package; otherwise npx cannot pick one.
    const names = Object.keys(pkg.bin);
    check(`${name}: npx can pick a command`, names.length === 1 || names.includes(p), names.join(', '));
  }
  return tgz;
}

/** Sends initialize and tools/list to an MCP server on stdio. @returns {Promise<{ serverInfo?: { name: string, version: string }, tools?: unknown[] }>} */
function mcpHandshake(/** @type {string[]} */ cmd, /** @type {string} */ cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd[0], cmd.slice(1), { cwd, stdio: ['pipe', 'pipe', 'inherit'] });
    /** @type {{ serverInfo?: { name: string, version: string }, tools?: unknown[] }} */
    const got = {};
    let buf = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('no answer within 120s')); }, 120_000);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('exit', (code) => { clearTimeout(timer); resolve(got); if (code) console.log(`  (server exited with ${code})`); });
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        /** @type {any} */
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          // Clients read stdout as JSON-RPC, so any other output breaks them.
          check('MCP stdout carries only JSON-RPC', false, line.slice(0, 200));
          continue;
        }
        if (msg.id === 1) got.serverInfo = msg.result?.serverInfo;
        if (msg.id === 2) { got.tools = msg.result?.tools; child.kill(); }
      }
    });
    const send = (/** @type {object} */ m) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pack-check', version: '0' } } });
    send({ method: 'notifications/initialized' });
    send({ id: 2, method: 'tools/list' });
  });
}

/** Runs what a user runs after installing: the library, the `ptext` command and the MCP server. */
async function smoke(/** @type {{ version: string, project: string, ptext: string, mcp: string[], mcpCwd: string }} */ t) {
  const lib = `import { runTool, VERSION } from '@ptext/core';
console.log(JSON.stringify({ version: VERSION, output: runTool('remove-duplicates', 'b\\na\\nb\\n').output }));`;
  const got = JSON.parse(run(process.execPath, ['--input-type=module', '-e', lib], { cwd: t.project }));
  check(`import @ptext/core: VERSION ${t.version}, runTool works`, got.version === t.version && got.output === 'b\na', JSON.stringify(got));

  check(`ptext --version`, run(t.ptext, ['--version']).trim() === t.version);
  const emails = run(t.ptext, ['run', 'extract-emails'], { input: EMAILS_IN }).trim();
  check(`ptext run extract-emails`, emails === EMAILS_OUT, JSON.stringify(emails));

  const mcp = t.mcp.length === 1 ? 'ptext-mcp' : t.mcp.join(' ');
  try {
    const { serverInfo, tools } = await mcpHandshake(t.mcp, t.mcpCwd);
    check(`${mcp}: initialize`, serverInfo?.name === 'ptext' && serverInfo.version === t.version, JSON.stringify(serverInfo));
    check(`${mcp}: tools/list`, Array.isArray(tools) && tools.length > 0, JSON.stringify(tools)?.slice(0, 200));
  } catch (e) {
    check(`${mcp}: initialize`, false, String(e));
  }
}

/** Waits until the registry lists every package at `version`; right after a publish it can lag. */
function waitForRegistry(/** @type {string} */ version) {
  for (let attempt = 1; ; attempt++) {
    const missing = PACKAGES.filter((p) => {
      try {
        return run('npm', ['view', `@ptext/${p}@${version}`, 'version'], { stdio: ['pipe', 'pipe', 'pipe'] }).trim() !== version;
      } catch {
        return true;
      }
    });
    if (missing.length === 0) return;
    if (attempt === 12) throw new Error(`not on npm after ${attempt} tries: ${missing.map((p) => `@ptext/${p}@${version}`).join(', ')}`);
    console.log(`waiting for npm to list ${missing.map((p) => `@ptext/${p}`).join(', ')}@${version}…`);
    execFileSync('sleep', ['15']);
  }
}

async function main() {
  const flag = process.argv.slice(2).find((a) => a.startsWith('--from-npm'));
  const unknown = process.argv.slice(2).filter((a) => a !== flag);
  if (unknown.length) throw new Error(`unknown arguments: ${unknown.join(' ')}`);
  const workspaceVersion = JSON.parse(readFileSync(join(ROOT, 'packages/core/package.json'), 'utf8')).version;
  const version = flag?.includes('=') ? flag.slice(flag.indexOf('=') + 1).replace(/^v/, '') : workspaceVersion;

  if (!flag) {
    const notBuilt = PACKAGES.filter((p) => !existsSync(join(ROOT, 'packages', p, 'dist')) || readdirSync(join(ROOT, 'packages', p, 'dist')).length === 0);
    if (notBuilt.length) throw new Error(`no dist/ in ${notBuilt.join(', ')}: run pnpm build first`);
  }
  const dir = mkdtempSync(join(tmpdir(), 'ptext-pack-check-'));
  const project = join(dir, 'project');
  const empty = join(dir, 'empty');
  for (const d of [project, empty]) mkdirSync(d);
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'pack-check', private: true, type: 'module' }));

  try {
    if (flag) {
      console.log(`Checking @ptext/*@${version} from npm`);
      waitForRegistry(version);
      npm(['install', `@ptext/core@${version}`], project);
      const prefix = join(dir, 'global');
      npm(['install', '-g', '--prefix', prefix, `@ptext/cli@${version}`], empty);
      await smoke({ version, project, ptext: join(prefix, 'bin', 'ptext'), mcp: ['npx', '-y', `@ptext/mcp@${version}`], mcpCwd: empty });
    } else {
      console.log(`Checking the workspace packages at ${version}`);
      const tarballs = PACKAGES.map((p) => packAndInspect(p, version, dir));
      // Installed together, so @ptext/mcp and @ptext/cli take @ptext/core from its tarball, not from npm.
      npm(['install', ...tarballs], project);
      const bin = join(project, 'node_modules', '.bin');
      await smoke({ version, project, ptext: join(bin, 'ptext'), mcp: [join(bin, 'ptext-mcp')], mcpCwd: project });
    }
  } catch (e) {
    check('install and run', false, e instanceof Error ? e.message : String(e));
  }

  if (failures.length) {
    console.error(`\npack-check: ${failures.length} check(s) failed. Files kept in ${dir}`);
    process.exit(1);
  }
  rmSync(dir, { recursive: true, force: true });
  console.log('\npack-check: all checks passed');
}

await main().catch((e) => {
  console.error(`pack-check: ${e.message}`);
  process.exit(1);
});
