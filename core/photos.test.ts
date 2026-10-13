// Photo library rules: matching, the scan source and the cleanup policy.
import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {loadRules, nodeHost} from './node';
import * as policy from './policy';
import {duplicateExtras, photoMatches, scan, similarExtras} from './scanner';
import type {PhotoAsset} from './host';

const DAY = 86400000, NOW = Date.parse('2026-10-13T12:00:00Z');
// Pixel size 0 (unknown) by default, so only the duplicate tests group items.
const asset = (fields: Partial<PhotoAsset>): PhotoAsset => ({id: 'A/L0/001', name: 'IMG_0001.JPG', media: 'image', subtypes: [], burst: 'none', bytes: 1000, created_ms: NOW, local: true, cloud: null, width: 0, height: 0, duration_ms: 0, ...fields});
const LIBRARY: PhotoAsset[] = [
  asset({id: 'video-big', name: 'IMG_0100.MOV', media: 'video', bytes: 300 * 1024 ** 2, created_ms: NOW - 2 * DAY}),
  asset({id: 'video-small', name: 'IMG_0101.MOV', media: 'video', bytes: 20 * 1024 ** 2}),
  asset({id: 'shot-old', name: 'IMG_0200.PNG', subtypes: ['screenshot'], bytes: 400_000, created_ms: NOW - 45 * DAY}),
  asset({id: 'shot-new', name: 'IMG_0201.PNG', subtypes: ['screenshot'], created_ms: NOW - 3 * DAY}),
  asset({id: 'recording', name: 'RPReplay.MP4', media: 'video', subtypes: ['screen-recording'], bytes: 30 * 1024 ** 2}),
  asset({id: 'burst-key', name: 'IMG_0300.JPG', burst: 'key'}),
  asset({id: 'burst-extra', name: 'IMG_0301.JPG', burst: 'extra', bytes: null}),
  asset({id: 'photo', name: 'IMG_0400.HEIC', bytes: 5_000_000}),
];
const photoHost = (photos: () => PhotoAsset[]) => ({...nodeHost, photos});

test('photoMatches needs every given criterion', () => {
  assert.equal(photoMatches({media: 'video', min_bytes: 100}, asset({media: 'video', bytes: 100}), NOW), true);
  assert.equal(photoMatches({media: 'video', min_bytes: 100}, asset({media: 'video', bytes: null}), NOW), false);
  assert.equal(photoMatches({subtype: 'screenshot', min_age_days: 30}, asset({subtypes: ['screenshot'], created_ms: NOW - 29 * DAY}), NOW), false);
  assert.equal(photoMatches({burst: 'extra'}, asset({burst: 'key'}), NOW), false);
});

test('exact copies are extras, except the oldest of each group', () => {
  const copy = (id: string, created_ms: number, fields: Partial<PhotoAsset> = {}) => asset({id, created_ms, width: 4032, height: 3024, bytes: 3_000_000, ...fields});
  const library = [
    copy('first', NOW - 10 * DAY), copy('again', NOW - 2 * DAY), copy('third', NOW),
    copy('other-size', NOW, {bytes: 3_000_001}), copy('video', NOW, {media: 'video', duration_ms: 4000}), copy('unknown', NOW, {bytes: null}),
  ];
  assert.deepEqual([...duplicateExtras(library)].sort(), ['again', 'third']);
  const report = scan(photoHost(() => library), loadRules(), {home: '/nonexistent', sources: ['photos'], now: NOW});
  assert.deepEqual(report.findings.map(f => [f.rule_id, f.path.slice(policy.PHOTO_PREFIX.length)]), [['duplicate-photos', 'again'], ['duplicate-photos', 'third']]);
});

test('items only in iCloud take no space here and are skipped; the others say where they are', () => {
  const big = (id: string, local: boolean | null, cloud: boolean | null) => asset({id, media: 'video', bytes: 200 * 1024 ** 2, local, cloud});
  const library = [big('phone-and-cloud', true, true), big('cloud-only', false, true), big('phone-only', true, false), big('unknown', null, null), asset({id: 'raw', bytes: 25 * 1024 ** 2})];
  const report = scan(photoHost(() => library), loadRules(), {home: '/nonexistent', sources: ['photos'], now: NOW});
  const byId = Object.fromEntries(report.findings.map(f => [f.path.slice(policy.PHOTO_PREFIX.length), f]));
  assert.deepEqual(Object.fromEntries(Object.entries(byId).map(([id, f]) => [id, f.rule_id])),
    {'phone-and-cloud': 'large-videos', 'phone-only': 'large-videos', unknown: 'large-videos', raw: 'large-photos'});
  assert.match(byId['phone-and-cloud']!.metadata['Onde está']!, /Otimizar Armazenamento/);
  assert.match(byId['phone-only']!.metadata['Onde está']!, /única cópia/);
  assert.equal(byId['unknown']!.metadata['Onde está'], undefined);
});

test('a copy on the iPhone of an original only in iCloud is still a copy', () => {
  const copy = (id: string, created_ms: number, local: boolean) => asset({id, created_ms, local, width: 4032, height: 3024, bytes: 3_000_000});
  const report = scan(photoHost(() => [copy('original', NOW - DAY, false), copy('copy', NOW, true)]), loadRules(), {home: '/nonexistent', sources: ['photos'], now: NOW});
  assert.deepEqual(report.findings.map(f => [f.rule_id, f.path]), [['duplicate-photos', `${policy.PHOTO_PREFIX}copy`]]);
});

test('in a group of similar photos the favorite or the best one stays', () => {
  const shot = (id: string, fields: Partial<PhotoAsset>) => asset({id, name: `${id}.HEIC`, bytes: 2_000_000, ...fields});
  const keepers = (library: PhotoAsset[]) => Object.fromEntries([...similarExtras(library)].map(([id, keeper]) => [id, keeper.id]));
  assert.deepEqual(keepers([shot('a', {similar: 'g', score: 0.2}), shot('b', {similar: 'g', score: 0.9}), shot('c', {similar: 'g', score: 0.5}), shot('d', {similar: 'h'})]), {a: 'b', c: 'b'});
  // A favorite stays even when another scores better, and no favorite is ever offered.
  assert.deepEqual(keepers([shot('a', {similar: 'g', score: 0.9}), shot('b', {similar: 'g', score: 0.1, favorite: true}), shot('c', {similar: 'g', favorite: true})]), {a: 'b'});
  // Without scores, the larger photo stays.
  assert.deepEqual(keepers([shot('a', {similar: 'g'}), shot('b', {similar: 'g', bytes: 3_000_000})]), {a: 'b'});
  assert.deepEqual(keepers([shot('a', {}), shot('b', {similar: null})]), {});
});

test('similar photos become findings that say which photo stays', () => {
  const shot = (id: string, score: number) => asset({id, name: `${id}.HEIC`, bytes: 2_000_000, similar: 'g', score});
  const report = scan(photoHost(() => [shot('try1', 0.3), shot('best', 0.8), {...shot('try2', 0.1), local: false}]), loadRules(), {home: '/nonexistent', sources: ['photos'], now: NOW});
  assert.deepEqual(report.findings.map(f => [f.rule_id, f.path, f.metadata['Fica']]), [['similar-photos', `${policy.PHOTO_PREFIX}try1`, 'best.HEIC']]);
});

test('photo items become findings with a photos:// path and a readable label', () => {
  const report = scan(photoHost(() => LIBRARY), loadRules(), {home: '/nonexistent', sources: ['photos'], now: NOW});
  const byId = Object.fromEntries(report.findings.map(f => [f.path.slice(policy.PHOTO_PREFIX.length), f]));
  assert.deepEqual(Object.keys(byId).sort(), ['burst-extra', 'recording', 'shot-new', 'shot-old', 'video-big']);
  assert.equal(byId['video-big']!.rule_id, 'large-videos');
  assert.equal(byId['video-big']!.metadata.label, 'IMG_0100.MOV');
  assert.equal(byId['video-big']!.last_modified, new Date(NOW - 2 * DAY).toISOString());
  assert.equal(byId['recording']!.rule_id, 'screen-recordings');
  assert.deepEqual([byId['burst-extra']!.size_bytes, byId['burst-extra']!.size_complete], [0, false]);
  assert.deepEqual(report.totals.by_category, {photos: 0, screenshots: 400_000 + 1000 + 30 * 1024 ** 2, videos: 300 * 1024 ** 2});
  assert.deepEqual(report.warnings, []);
});

test('the disk source is skipped when only photos are asked for, and vice versa', () => {
  const report = scan(photoHost(() => LIBRARY), loadRules(), {home: '/nonexistent', sources: ['disk'], now: NOW});
  assert.ok(!report.findings.some(f => f.path.startsWith(policy.PHOTO_PREFIX)));
  assert.equal(scan(nodeHost, loadRules(), {home: '/nonexistent', sources: ['photos']}).findings.length, 0);
});

test('a denied photo library becomes a warning', () => {
  const report = scan(photoHost(() => {throw new Error('Sem acesso às Fotos.');}), loadRules(), {home: '/nonexistent', sources: ['photos']});
  assert.deepEqual(report.warnings, ['cannot read photos: Sem acesso às Fotos.']);
});

test('photo findings are allowed for review only, and only for photo rules', () => {
  const report = scan(photoHost(() => LIBRARY), loadRules(), {home: '/nonexistent', sources: ['photos'], now: NOW});
  for (const finding of report.findings) {
    assert.deepEqual(policy.policy(nodeHost, finding, '/h', '/app'), {allowed: true, review: true}, finding.rule_id);
    assert.equal(policy.isAutomatic(finding, NOW), false);
  }
  const forged = {...report.findings[0]!, rule_id: 'npm-cache', severity: 'SAFE' as const};
  assert.equal(policy.policy(nodeHost, forged, '/h', '/app').allowed, false);
  assert.equal(policy.policy(nodeHost, {...report.findings[0]!, severity: 'DANGER'}, '/h', '/app').allowed, false);
});
