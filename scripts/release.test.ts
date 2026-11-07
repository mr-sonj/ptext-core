import { beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
// @ts-expect-error plain ESM script without types
import { applyRelease, autoVersion, bumpLevel, changelogSection, nextVersion, readVersions, releaseNotes, updateChangelog, VERSION_FILES, VERSION_TS } from './release.mjs';

const c = (subject: string, body = '', sha = 'abcdef1234567') => ({ sha, subject, body });
const repoRoot = new URL('../', import.meta.url);

describe('release script', () => {
  it('picks the bump from Conventional Commits', () => {
    expect(bumpLevel([c('fix: x'), c('docs: y')])).toBe('patch');
    expect(bumpLevel([c('fix: x'), c('feat(cli): y')])).toBe('minor');
    expect(bumpLevel([c('feat!: drop option')])).toBe('major');
    expect(bumpLevel([c('refactor: x', 'BREAKING CHANGE: result shape changed')])).toBe('major');
    expect(bumpLevel([c('update stuff')])).toBe('patch');
  });

  it('bumps semver, and a breaking change on 0.x only bumps minor', () => {
    expect(nextVersion('0.1.0', 'patch')).toBe('0.1.1');
    expect(nextVersion('0.1.3', 'minor')).toBe('0.2.0');
    expect(nextVersion('0.9.3', 'major')).toBe('1.0.0');
    expect(autoVersion('0.4.2', [c('feat!: x')])).toBe('0.5.0');
    expect(autoVersion('1.4.2', [c('feat!: x')])).toBe('2.0.0');
    expect(() => nextVersion('1.0.0-beta.1', 'patch')).toThrow();
  });

  it('groups release notes and keeps the scope', () => {
    const notes = releaseNotes([c('feat(core): add csv-to-yaml'), c('fix: trim BOM'), c('chore: deps'), c('feat!: rename x')]);
    expect(notes).toBe(
      [
        '### Breaking changes\n\n- rename x (abcdef1)',
        '### Features\n\n- **core:** add csv-to-yaml (abcdef1)',
        '### Fixes\n\n- trim BOM (abcdef1)',
        '### Other\n\n- chore: deps (abcdef1)',
      ].join('\n\n'),
    );
    expect(releaseNotes([c('fix: trim BOM', '', '')])).toBe('### Fixes\n\n- trim BOM');
  });

  it('prepends a CHANGELOG section above the newest one', () => {
    const before = '# Changelog\n\nIntro.\n\n## [0.1.0] - 2026-11-07\n\nOld.\n';
    const { changelog, notes } = updateChangelog(before, '0.2.0', '2026-12-01', '### Fixes\n\n- x (abc1234)');
    expect(changelog).toBe('# Changelog\n\nIntro.\n\n## [0.2.0] - 2026-12-01\n\n### Fixes\n\n- x (abc1234)\n\n## [0.1.0] - 2026-11-07\n\nOld.\n');
    expect(notes).toBe('### Fixes\n\n- x (abc1234)');
  });

  it('reads and reuses an existing section', () => {
    const log = '# Changelog\n\n## [0.2.0] - 2026-12-01\n\nNew.\n\n## [0.1.0] - 2026-11-07\n\nOld.\n';
    expect(updateChangelog(log, '0.2.0', '2026-12-02', 'ignored')).toEqual({ changelog: log, notes: 'New.' });
    expect(changelogSection(log, '0.1.0')).toBe('Old.');
    expect(changelogSection(log, '0.3.0')).toBeNull();
  });

  it('every version file is in lockstep', () => {
    const versions = Object.values(readVersions(repoRoot));
    expect(versions).toHaveLength(VERSION_FILES.length + 1);
    expect(new Set(versions).size).toBe(1);
  });

  it('applyRelease writes every version file and the changelog; `notes` checks them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ptext-release-'));
    for (const f of [...VERSION_FILES, VERSION_TS, 'CHANGELOG.md', 'scripts/release.mjs']) {
      mkdirSync(join(dir, f, '..'), { recursive: true });
      cpSync(new URL(f, repoRoot), join(dir, f));
    }
    const root = pathToFileURL(dir + '/');
    expect(applyRelease(root, { version: '9.9.9', date: '2026-12-01', notes: '### Fixes\n\n- x (abc1234)' })).toBe('### Fixes\n\n- x (abc1234)');
    expect(new Set(Object.values(readVersions(root)))).toEqual(new Set(['9.9.9']));
    expect(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8')).toContain('## [9.9.9] - 2026-12-01');

    const cli = (v: string) => execFileSync('node', [join(dir, 'scripts/release.mjs'), 'notes', v], { encoding: 'utf8', stdio: 'pipe' });
    expect(cli('v9.9.9')).toBe('### Fixes\n\n- x (abc1234)\n');
    expect(() => cli('v9.9.8')).toThrow(/does not match/);
  });
});

describe('release cut', () => {
  // A throwaway repo with a bare `origin`, holding just the files a release writes.
  const base = mkdtempSync(join(tmpdir(), 'ptext-cut-'));
  const work = join(base, 'work');
  const sh = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  const git = (...args: string[]) => sh(work, args);
  const cut = (...args: string[]) => execFileSync('node', [join(work, 'scripts/release.mjs'), 'cut', ...args], { encoding: 'utf8', stdio: 'pipe' });
  const fails = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return String((e as { stderr?: string }).stderr ?? e);
    }
    throw new Error('expected a failure');
  };
  const commit = (file: string, text: string, msg: string) => {
    writeFileSync(join(work, file), text);
    git('add', file);
    git('commit', '-q', '-m', msg);
  };

  beforeAll(() => {
    sh(base, ['init', '-q', '--bare', '-b', 'main', 'origin.git']);
    sh(base, ['init', '-q', '-b', 'main', 'work']);
    for (const [k, v] of [['user.name', 'Dev'], ['user.email', 'dev@x'], ['commit.gpgsign', 'false'], ['tag.gpgSign', 'false']]) git('config', k!, v!);
    for (const f of [...VERSION_FILES, VERSION_TS, 'CHANGELOG.md', 'scripts/release.mjs']) {
      mkdirSync(join(work, f, '..'), { recursive: true });
      cpSync(new URL(f, repoRoot), join(work, f));
    }
    applyRelease(pathToFileURL(work + '/'), { version: '0.4.0', date: '2026-11-01', notes: '- Start.' });
    git('add', '-A');
    git('commit', '-q', '-m', 'chore(release): v0.4.0');
    git('tag', '-a', 'v0.4.0', '-m', 'v0.4.0');
    git('remote', 'add', 'origin', join(base, 'origin.git'));
    git('push', '-q', 'origin', 'main', 'v0.4.0');
  });

  it('says so when there is nothing to release', () => {
    expect(cut('--skip-tests')).toBe('nothing to release since v0.4.0\n');
  });

  it('--dry-run previews the version and notes and writes nothing', () => {
    commit('a.txt', 'a\n', 'fix(core): trim BOM');
    commit('b.txt', 'b\n', 'feat(cli): add --json');
    const head = git('rev-parse', 'HEAD');
    const out = cut('--dry-run');
    expect(out).toContain('release: v0.4.0 → v0.5.0');
    expect(out).toContain(`- **cli:** add --json (${head.slice(0, 7)})`);
    expect(git('rev-parse', 'HEAD')).toBe(head);
    expect(git('status', '--porcelain')).toBe('');
  });

  it('refuses off main, with uncommitted changes, or behind origin', () => {
    git('checkout', '-q', '-b', 'topic');
    expect(fails(() => cut('--skip-tests'))).toMatch(/on main, not topic/);
    git('checkout', '-q', 'main');
    writeFileSync(join(work, 'a.txt'), 'changed\n');
    expect(fails(() => cut('--skip-tests'))).toMatch(/uncommitted changes/);
    git('checkout', '-q', '--', 'a.txt');

    sh(base, ['clone', '-q', 'origin.git', 'other']);
    const other = join(base, 'other');
    writeFileSync(join(other, 'c.txt'), 'c\n');
    sh(other, ['add', 'c.txt']);
    sh(other, ['-c', 'user.name=Contributor', '-c', 'user.email=c@x', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'fix: merged on GitHub']);
    sh(other, ['push', '-q', 'origin', 'main']);
    expect(fails(() => cut('--skip-tests'))).toMatch(/origin\/main has commits that main does not; pull first/);
    git('pull', '-q', '--rebase', 'origin', 'main');
  });

  it('writes the release, commits, tags and pushes main + tag', () => {
    expect(cut('--skip-tests')).toContain('pushed main + v0.5.0 → origin');
    expect(git('log', '-1', '--format=%s')).toBe('chore(release): v0.5.0');
    expect(new Set(Object.values(readVersions(pathToFileURL(work + '/'))))).toEqual(new Set(['0.5.0']));
    const changelog = readFileSync(join(work, 'CHANGELOG.md'), 'utf8');
    expect(changelog).toMatch(/## \[0\.5\.0\] [^]*### Features\n\n- \*\*cli:\*\* add --json[^]*### Fixes\n\n- merged on GitHub[^]*- \*\*core:\*\* trim BOM[^]*## \[0\.4\.0\]/);
    expect(changelog).toContain(`merged on GitHub (${git('rev-parse', '--short=7', 'HEAD~3')})`);
    expect(sh(join(base, 'origin.git'), ['rev-parse', 'main'])).toBe(git('rev-parse', 'HEAD'));
    expect(sh(join(base, 'origin.git'), ['rev-parse', 'v0.5.0^{commit}'])).toBe(git('rev-parse', 'HEAD'));
  });

  it('--bump forces the level; --no-push only tags', () => {
    commit('a.txt', 'a2\n', 'docs: wording');
    expect(cut('--skip-tests', '--bump=major', '--no-push')).toContain('tagged v1.0.0, not pushed');
    expect(sh(join(base, 'origin.git'), ['tag'])).toBe('v0.4.0\nv0.5.0');
    expect(fails(() => cut('--bump=huge'))).toMatch(/--bump must be/);
  });
});
