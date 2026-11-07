import { describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
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
