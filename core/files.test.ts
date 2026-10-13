// Files from picked folders (iPhone) and the storage line of the report.
import {afterEach, test} from 'bun:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {loadRules, nodeHost} from './node';
import * as policy from './policy';
import {duplicateFileExtras, fileMatches, scan} from './scanner';
import {buildTree, removeTempDirs, tempDir} from './test-support';
import type {FileItem, Host} from './host';

afterEach(removeTempDirs);

const DAY = 86400000, NOW = Date.parse('2026-10-13T12:00:00Z'), MB = 1024 ** 2;
const item = (fields: Partial<FileItem>): FileItem => ({path: '/files/a.pdf', label: 'No Meu iPhone › a.pdf', bytes: 1000, modified_ms: NOW, local: true, cloud: false, ...fields});
const fileHost = (files: () => FileItem[]): Host => ({...nodeHost, files});

test('fileMatches needs every given criterion', () => {
  assert.equal(fileMatches({folders: ['Downloads'], min_age_days: 30}, item({path: '/d/Downloads/x/a.zip', modified_ms: NOW - 31 * DAY}), NOW), true);
  assert.equal(fileMatches({folders: ['Downloads']}, item({path: '/d/Downloads.zip'}), NOW), false);
  assert.equal(fileMatches({folders: ['Downloads']}, item({path: '/d/Downloads'}), NOW), false);
  assert.equal(fileMatches({folders: ['tmp', 'Caches']}, item({path: '/d/App/Library/Caches/x.bin'}), NOW), true);
  assert.equal(fileMatches({extensions: ['zip']}, item({path: '/d/Backup.ZIP'}), NOW), true);
  assert.equal(fileMatches({extensions: ['zip']}, item({path: '/d/zip'}), NOW), false);
  assert.equal(fileMatches({extensions: ['zip']}, item({path: '/d/.zip'}), NOW), false);
  assert.equal(fileMatches({duplicate: 'extra'}, item({path: '/d/a.pdf'}), NOW, new Set(['/d/a.pdf'])), true);
  assert.equal(fileMatches({min_bytes: 10}, item({bytes: 9}), NOW), false);
});

test('duplicate files need the same content hash; the oldest stays', () => {
  const file = (path: string, modified_ms: number, digest: string | null | undefined, bytes = 5 * MB) => item({path, modified_ms, digest, bytes});
  const extras = duplicateFileExtras([file('/d/a.pdf', 1, 'x'), file('/d/a 2.pdf', 2, 'x'), file('/d/b.pdf', 3, 'y'), file('/d/c.pdf', 4, null), file('/d/d.pdf', 5, null), file('/d/e.pdf', 6, undefined), file('/d/f.pdf', 7, undefined)]);
  assert.deepEqual([...extras], ['/d/a 2.pdf']);
  const report = scan(fileHost(() => [file('/d/a.pdf', 1, 'x'), file('/d/a 2.pdf', 2, 'x'), item({path: '/d/App/Library/Caches/img.bin'}), item({path: '/d/setup.zip'}), item({path: '/d/app.log'})]), loadRules(), {home: '/nonexistent', sources: ['files'], now: NOW});
  assert.deepEqual(Object.fromEntries(report.findings.map(f => [f.path, f.rule_id])),
    {'/d/a 2.pdf': 'duplicate-files', '/d/App/Library/Caches/img.bin': 'app-file-caches', '/d/setup.zip': 'installers', '/d/app.log': 'log-files'});
  for (const finding of report.findings) assert.equal(policy.isAutomatic(finding, NOW), false);
});

test('picked files on the iPhone become findings with a readable label and where they are', () => {
  const files = [
    item({path: '/d/movie.mov', label: 'iCloud Drive › movie.mov', bytes: 2000 * MB, local: true, cloud: true}),
    item({path: '/d/backup.zip', label: 'iCloud Drive › backup.zip', bytes: 500 * MB, local: false, cloud: true}),
    item({path: '/d/Downloads/old.pdf', label: 'iCloud Drive › Downloads › old.pdf', modified_ms: NOW - 60 * DAY}),
    item({path: '/d/Downloads/new.pdf', modified_ms: NOW - 2 * DAY}),
    item({path: '/d/notes.txt'}),
  ];
  const report = scan(fileHost(() => files), loadRules(), {home: '/nonexistent', sources: ['files'], now: NOW});
  const byPath = Object.fromEntries(report.findings.map(f => [f.path, f]));
  assert.deepEqual(Object.fromEntries(Object.entries(byPath).map(([p, f]) => [p, f.rule_id])),
    {'/d/movie.mov': 'large-files', '/d/Downloads/old.pdf': 'old-downloads'});
  assert.equal(byPath['/d/movie.mov']!.metadata.label, 'iCloud Drive › movie.mov');
  assert.match(byPath['/d/movie.mov']!.metadata['Onde está']!, /Remover Download/);
  assert.deepEqual(report.totals.by_category, {downloads: 1000, files: 2000 * MB});
});

test('picked folders are skipped without the files source, and errors become warnings', () => {
  const files = () => [item({bytes: 200 * MB})];
  assert.equal(scan(fileHost(files), loadRules(), {home: '/nonexistent', sources: ['photos']}).findings.length, 0);
  const report = scan(fileHost(() => {throw new Error('Pasta indisponível.');}), loadRules(), {home: '/nonexistent', sources: ['files']});
  assert.deepEqual(report.warnings, ['cannot read picked folders: Pasta indisponível.']);
});

test('file findings may be cleaned only as regular files, for review', () => {
  const root = tempDir();
  buildTree(root, {'Downloads/big.zip': 10, 'Downloads/folder/a': 10});
  const file = path.join(root, 'Downloads/big.zip'), dir = path.join(root, 'Downloads/folder');
  const report = scan(fileHost(() => [item({path: file, bytes: 200 * MB}), item({path: dir, bytes: 200 * MB})]), loadRules(), {home: root, sources: ['files'], now: NOW});
  const decide = (target: string) => policy.policy(nodeHost, report.findings.find(f => f.path === target)!, root, '/app');
  assert.deepEqual(decide(file), {allowed: true, review: true});
  assert.equal(decide(dir).allowed, false);
  assert.equal(policy.policy(nodeHost, {...report.findings[0]!, path: file}, root, root).allowed, false);
  for (const finding of report.findings) assert.equal(policy.isAutomatic(finding, NOW), false);
});

test('the report says how much space the volume has', () => {
  const {storage} = scan(nodeHost, loadRules(), {home: tempDir(), categories: ['node']});
  assert.ok(storage && storage.total_bytes > 0 && storage.free_bytes > 0 && storage.free_bytes <= storage.total_bytes);
  assert.equal(storage.purgeable_bytes, null);
  const broken = scan({...nodeHost, storage: () => {throw new Error('no statfs');}}, loadRules(), {home: tempDir(), categories: ['node']});
  assert.equal(broken.storage, null);
  const {storage: _, ...without} = nodeHost;
  assert.equal(scan(without, loadRules(), {home: tempDir(), categories: ['node']}).storage, null);
});
