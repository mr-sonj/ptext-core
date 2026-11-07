#!/usr/bin/env node
// Release helpers. Versions come from Conventional Commits: breaking (`type!:` or `BREAKING CHANGE:`) → major,
// `feat` → minor, anything else → patch, and while the version is 0.x a breaking change bumps minor. A release
// writes one version to every package.json and to VERSION in packages/core/src/index.ts, adds a CHANGELOG.md
// section and is tagged vX.Y.Z. CI turns the tag into a GitHub release with:
//
//   node scripts/release.mjs notes <version>   prints that version's CHANGELOG section; fails if a version file disagrees
//
// A maintainer cuts the release on a clean, up-to-date `main`:
//
//   node scripts/release.mjs cut [--dry-run] [--bump=auto|patch|minor|major] [--skip-tests] [--no-push] [--remote=origin]
//       Reads the commits since the tag of the current version, runs `pnpm build && pnpm test`, writes the release,
//       commits `chore(release): vX.Y.Z`, tags it and pushes main + tag in one atomic push.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CONVENTIONAL = /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?(?<bang>!)?: (?<desc>.+)$/;
export const VERSION_FILES = ['package.json', 'packages/core/package.json', 'packages/mcp/package.json', 'packages/cli/package.json'];
export const VERSION_TS = 'packages/core/src/index.ts';
const VERSION_JSON = /"version": "[^"]*"/;
const VERSION_CONST = /export const VERSION = '([^']*)';/;

/** @typedef {{ sha: string, subject: string, body: string }} Commit */

/** @param {Commit} c */
const isBreaking = (c) => CONVENTIONAL.exec(c.subject)?.groups?.bang === '!' || /^BREAKING[ -]CHANGE:/m.test(c.body);

/** @param {Commit[]} commits @returns {'major' | 'minor' | 'patch'} */
export function bumpLevel(commits) {
  if (commits.some(isBreaking)) return 'major';
  if (commits.some((c) => CONVENTIONAL.exec(c.subject)?.groups?.type === 'feat')) return 'minor';
  return 'patch';
}

/** @param {string} version @param {'major' | 'minor' | 'patch'} level */
export function nextVersion(version, level) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) throw new Error(`not a plain x.y.z version: ${version}`);
  const [maj, min, pat] = m.slice(1).map(Number);
  if (level === 'major') return `${maj + 1}.0.0`;
  if (level === 'minor') return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

/** auto: the level from the commits, with a breaking change on 0.x bumping minor. */
export function autoVersion(version, commits) {
  const level = bumpLevel(commits);
  return nextVersion(version, level === 'major' && version.startsWith('0.') ? 'minor' : level);
}

/** Release notes in Markdown, grouped by kind. @param {Commit[]} commits */
export function releaseNotes(commits) {
  const groups = { 'Breaking changes': [], Features: [], Fixes: [], Other: [] };
  for (const c of commits) {
    const g = CONVENTIONAL.exec(c.subject)?.groups;
    const key = isBreaking(c) ? 'Breaking changes' : g?.type === 'feat' ? 'Features' : g?.type === 'fix' ? 'Fixes' : 'Other';
    // "Other" mixes types, so it keeps the subject as written (`chore: deps`).
    const text = g && key !== 'Other' ? `${g.scope ? `**${g.scope}:** ` : ''}${g.desc}` : c.subject;
    groups[key].push(`- ${text}${c.sha ? ` (${c.sha.slice(0, 7)})` : ''}`);
  }
  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([title, items]) => `### ${title}\n\n${items.join('\n')}`)
    .join('\n\n');
}

/** The body of the `## [version]` section, or null when there is none. */
export function changelogSection(changelog, version) {
  const start = changelog.indexOf(`\n## [${version}]`);
  if (start === -1) return null;
  const body = changelog.slice(changelog.indexOf('\n', start + 1) + 1);
  const end = body.search(/^## \[/m);
  return (end === -1 ? body : body.slice(0, end)).trim();
}

/** Insert a section above the newest entry, or reuse the existing section for `version`. */
export function updateChangelog(changelog, version, date, notes) {
  const existing = changelogSection(changelog, version);
  if (existing !== null) return { changelog, notes: existing };
  const section = `## [${version}] - ${date}\n\n${notes}\n\n`;
  const first = changelog.search(/^## \[/m);
  return {
    changelog: first === -1 ? `${changelog.trimEnd()}\n\n${section}` : changelog.slice(0, first) + section + changelog.slice(first),
    notes,
  };
}

/** Every version the release keeps in lockstep, by file. @param {URL} root */
export function readVersions(root) {
  const out = {};
  for (const f of VERSION_FILES) out[f] = JSON.parse(readFileSync(new URL(f, root), 'utf8')).version;
  out[VERSION_TS] = VERSION_CONST.exec(readFileSync(new URL(VERSION_TS, root), 'utf8'))?.[1];
  return out;
}

/** Write `version` to every version file and add its CHANGELOG section. Returns the notes. @param {URL} root */
export function applyRelease(root, { version, date, notes }) {
  for (const f of VERSION_FILES) {
    const src = readFileSync(new URL(f, root), 'utf8');
    if (!VERSION_JSON.test(src)) throw new Error(`no "version" field in ${f}`);
    writeFileSync(new URL(f, root), src.replace(VERSION_JSON, `"version": "${version}"`));
  }
  const ts = readFileSync(new URL(VERSION_TS, root), 'utf8');
  if (!VERSION_CONST.test(ts)) throw new Error(`no VERSION constant in ${VERSION_TS}`);
  writeFileSync(new URL(VERSION_TS, root), ts.replace(VERSION_CONST, `export const VERSION = '${version}';`));
  const result = updateChangelog(readFileSync(new URL('CHANGELOG.md', root), 'utf8'), version, date, notes || '- Maintenance release.');
  writeFileSync(new URL('CHANGELOG.md', root), result.changelog);
  return result.notes;
}

/** Commits in `range`, oldest first. Merge commits are left out: their branches' commits are listed instead. */
function commitsIn(git, range) {
  return git('log', '--reverse', '--no-merges', '--format=%H%x00%s%x00%b%x1e', range)
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [sha, subject, body] = r.split('\0');
      return { sha, subject, body: body.trim() };
    });
}

/** Cut a release on main: version, changelog, `chore(release)` commit, tag, push. @param {URL} root */
function cut(root, flags) {
  const cwd = fileURLToPath(root);
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const log = (s) => process.stdout.write(`${s}\n`);
  const remote = flags.remote || 'origin';
  const bump = flags.bump || 'auto';
  if (!['auto', 'patch', 'minor', 'major'].includes(bump)) throw new Error(`--bump must be auto, patch, minor or major, not "${bump}"`);

  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  if (branch !== 'main') throw new Error(`cut a release on main, not ${branch}`);
  if (git('status', '--porcelain', '--untracked-files=no')) throw new Error('main has uncommitted changes; commit them first');
  if (!flags['no-push']) {
    git('fetch', '-q', remote, 'main');
    if (git('rev-list', '--count', 'HEAD..FETCH_HEAD') !== '0') throw new Error(`${remote}/main has commits that main does not; pull first`);
  }

  const current = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).version;
  try {
    git('rev-parse', '--verify', '-q', `refs/tags/v${current}`);
  } catch {
    throw new Error(`no tag v${current} for the current version`);
  }
  const commits = commitsIn(git, `v${current}..HEAD`);
  if (commits.length === 0 && bump === 'auto') return log(`nothing to release since v${current}`);
  const version = bump === 'auto' ? autoVersion(current, commits) : nextVersion(current, bump);
  const notes = releaseNotes(commits);
  log(`${commits.length} commit(s) since v${current}:`);
  for (const c of commits) log(`  ${c.sha.slice(0, 7)} ${c.subject}`);
  log(`release: v${current} → v${version}`);
  if (flags['dry-run']) return log(`\n${notes || '- Maintenance release.'}`);

  if (!flags['skip-tests']) {
    execFileSync('pnpm', ['build'], { cwd, stdio: 'inherit' });
    execFileSync('pnpm', ['test'], { cwd, stdio: 'inherit' });
  }
  applyRelease(root, { version, date: new Date().toISOString().slice(0, 10), notes });
  git('commit', '-q', '-m', `chore(release): v${version}`, '--', ...VERSION_FILES, VERSION_TS, 'CHANGELOG.md');
  git('tag', '-a', `v${version}`, '-m', `v${version}`);
  if (flags['no-push']) return log(`tagged v${version}, not pushed (--no-push). Later: git push --atomic ${remote} main v${version}`);
  git('push', '-q', '--atomic', remote, 'refs/heads/main:refs/heads/main', `refs/tags/v${version}`);
  log(`pushed main + v${version} → ${remote}`);
}

function main() {
  const root = new URL('../', import.meta.url);
  const [cmd, arg, ...rest] = process.argv.slice(2);
  if (cmd === 'cut') {
    const flags = Object.fromEntries(
      [arg, ...rest].filter(Boolean).map((a) => {
        const m = /^--(dry-run|bump|skip-tests|no-push|remote)(?:=(.*))?$/.exec(a);
        if (!m) throw new Error(`unknown argument ${a}`);
        return [m[1], m[2] ?? true];
      }),
    );
    return cut(root, flags);
  }
  if (cmd !== 'notes' || !arg) throw new Error('usage: node scripts/release.mjs notes <version> | cut [--dry-run] [--bump=…] [--skip-tests] [--no-push]');
  const version = arg.replace(/^v/, '');
  const wrong = Object.entries(readVersions(root)).filter(([, v]) => v !== version);
  if (wrong.length) throw new Error(`v${version} does not match ${wrong.map(([f, v]) => `${f} (${v})`).join(', ')}`);
  const notes = changelogSection(readFileSync(new URL('CHANGELOG.md', root), 'utf8'), version);
  if (notes === null) throw new Error(`CHANGELOG.md has no [${version}] section`);
  process.stdout.write(`${notes}\n`);
}

// realpath: the script may be run through a symlinked path (on macOS the temp dir is one).
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    process.stderr.write(`release: ${e.message}\n`);
    process.exit(1);
  }
}
