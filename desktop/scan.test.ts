import {test} from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {scan} from './scan';

const SOURCE = {worker: path.join(import.meta.dirname, 'scan-worker.ts'), rulesDir: path.resolve(import.meta.dirname, '..', 'rules')};
test('Electron bridge scans real artifacts and preserves review classification', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'devclean-electron-'));
  try {
    const node = path.join(home, 'projects', 'app with spaces', 'node_modules');
    const avd = path.join(home, '.android', 'avd', 'pixel.avd');
    await fs.mkdir(node, {recursive:true});await fs.mkdir(avd, {recursive:true});
    await fs.writeFile(path.join(node,'index.js'),'12345');
    await fs.writeFile(path.join(avd,'userdata.img'),'123');
    const report = await scan(SOURCE, home);
    assert.equal(report.schema_version, 1);
    assert.equal(report.findings.find(f=>f.rule_id==='node-modules')!.size_bytes,5);
    const environment = report.findings.find(f=>f.rule_id==='android-avds')!;
    assert.equal(environment.severity,'REVIEW');assert.equal(environment.reclaimable,false);
    assert.equal(await fs.readFile(path.join(node,'index.js'),'utf8'),'12345');
  } finally {await fs.rm(home,{recursive:true,force:true});}
});
