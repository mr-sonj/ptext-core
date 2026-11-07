#!/usr/bin/env node
// Release helpers. Versions come from Conventional Commits: breaking (`type!:` or `BREAKING CHANGE:`) → major,
// `feat` → minor, anything else → patch, and while the version is 0.x a breaking change bumps minor. A release
// writes one version to every package.json and to VERSION in packages/core/src/index.ts, adds a CHANGELOG.md
// section and is tagged vX.Y.Z. CI turns the tag into a GitHub release with:
//
//   node scripts/release.mjs notes <version>   prints that version's CHANGELOG section; fails if a version file disagrees
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

function main() {
  const root = new URL('../', import.meta.url);
  const [cmd, arg] = process.argv.slice(2);
  if (cmd !== 'notes' || !arg) throw new Error('usage: node scripts/release.mjs notes <version>');
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
