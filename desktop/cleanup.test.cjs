const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const cleanup = require('./cleanup.cjs');
async function fixture(run) {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'devclean-cleanup-')));
  const target = path.join(home,'.npm','_cacache');
  await fs.mkdir(target,{recursive:true});await fs.writeFile(path.join(target,'cache'),'cache');
  const finding={rule_id:'npm-cache',path:target,severity:'SAFE',reclaimable:true,size_complete:true,size_bytes:5,category:'node'};
  const report={findings:[finding],totals:{},warnings:[]};
  try {await run({home,target,finding,report});} finally {await fs.rm(home,{recursive:true,force:true});}
}
test('moves only selected authorized targets and refreshes totals',()=>fixture(async({home,target,report})=>{
  const prepared=await cleanup.prepare(report,home,path.join(home,'devclean'));
  const items=cleanup.select(prepared.report,[0,0],prepared.report.cleanup_token);
  const called=[];const result=await cleanup.moveToTrash(items,prepared.manifest,async p=>called.push(p));
  assert.deepEqual(called,[target]);assert.equal(result.moved.length,1);
  const remaining=cleanup.remainingReport(prepared.report,result.moved);
  assert.equal(remaining.totals.bytes,0);assert.equal(remaining.findings.length,0);
  assert.notEqual(remaining.cleanup_token,prepared.report.cleanup_token);
  await assert.rejects(cleanup.moveToTrash(items,prepared.manifest,async()=>assert.fail('Repeated cleanup')));
}));
test('blocks arbitrary paths, review, danger, partial measurements and own dependencies',()=>fixture(async({home,target,finding})=>{
  const app=path.join(home,'app');const own=path.join(app,'node_modules');await fs.mkdir(own,{recursive:true});
  for(const f of [{...finding,path:home},{...finding,severity:'REVIEW'},{...finding,severity:'DANGER'},{...finding,size_complete:false},{...finding,rule_id:'node-modules',path:own}]) {
    const prepared=await cleanup.prepare({findings:[f]},home,app);
    assert.equal(prepared.report.findings[0].cleanup_allowed,false);
    assert.throws(()=>cleanup.select(prepared.report,[0],prepared.report.cleanup_token));
  }
}));
test('rejects symlinks and stale directory replacements before invoking trash',()=>fixture(async({home,target,report})=>{
  const prepared=await cleanup.prepare(report,home,path.join(home,'app'));
  const items=cleanup.select(prepared.report,[0],prepared.report.cleanup_token);
  await fs.rename(target,target+'-old');await fs.symlink(target+'-old',target);
  await assert.rejects(cleanup.moveToTrash(items,prepared.manifest,async()=>assert.fail('Unsafe trash')));
  const linked=await cleanup.prepare(report,home,path.join(home,'app'));
  assert.equal(linked.report.findings[0].cleanup_allowed,false);
}));
test('rejects invalid indices and old report tokens',()=>fixture(async({home,report})=>{
  const p=await cleanup.prepare(report,home,path.join(home,'app'));
  for(const indices of [[],[-1],[999],['0'],[0.5]]) assert.throws(()=>cleanup.select(p.report,indices,p.report.cleanup_token));
  assert.throws(()=>cleanup.select(p.report,[0],'old'));
}));
test('preserves failed items and reports partial success',()=>fixture(async({home,finding,report})=>{
  const target2=path.join(home,'.gradle','caches');await fs.mkdir(target2,{recursive:true});
  report.findings.push({...finding,rule_id:'gradle-cache',path:target2});
  const p=await cleanup.prepare(report,home,path.join(home,'app'));
  const items=cleanup.select(p.report,[0,1],p.report.cleanup_token);
  const result=await cleanup.moveToTrash(items,p.manifest,async target=>{if(target===target2) throw new Error('Permission denied');});
  assert.equal(result.moved.length,1);assert.equal(result.errors.length,1);
  const remaining=cleanup.remainingReport(p.report,result.moved);
  assert.equal(remaining.findings[0].path,target2);
}));
test('allows Cargo targets and every Device Support folder, but only with real markers',()=>fixture(async({home,finding})=>{
  const crate=path.join(home,'code','crate');const target=path.join(crate,'target');await fs.mkdir(target,{recursive:true});
  const support=path.join(home,'Library','Developer','Xcode','watchOS DeviceSupport');await fs.mkdir(support,{recursive:true});
  const rust={...finding,rule_id:'rust-target',path:target,metadata:{'Cargo.toml':'yes'}};
  const report={findings:[rust,{...finding,rule_id:'xcode-device-support',path:support}]};
  let p=await cleanup.prepare(report,home,path.join(home,'app'));
  assert.equal(p.report.findings[0].cleanup_allowed,false,'metadata alone is not enough');
  assert.equal(p.report.findings[1].cleanup_allowed,true);
  await fs.writeFile(path.join(crate,'Cargo.toml'),'[package]');
  p=await cleanup.prepare(report,home,path.join(home,'app'));
  assert.equal(p.report.findings[0].cleanup_allowed,true);
  const other={...finding,rule_id:'xcode-device-support',path:path.join(home,'Library','Developer','Xcode')};
  p=await cleanup.prepare({findings:[other]},home,path.join(home,'app'));
  assert.equal(p.report.findings[0].cleanup_allowed,false);
}));
test('versioned Android Studio caches match only direct children with the prefix',()=>fixture(async({home,finding})=>{
  const caches=path.join(home,'Library','Caches','Google');
  const cases=[[path.join(caches,'AndroidStudio2026.2'),true],[path.join(caches,'AndroidStudio'),false],[path.join(caches,'Chrome'),false],[path.join(caches,'AndroidStudio2026.2','x'),false]];
  for(const [dir] of cases) await fs.mkdir(dir,{recursive:true});
  const p=await cleanup.prepare({findings:cases.map(([dir])=>({...finding,rule_id:'jetbrains-caches',path:dir}))},home,path.join(home,'app'));
  assert.deepEqual(p.report.findings.map(f=>f.cleanup_allowed),cases.map(([,ok])=>ok));
}));
test('automatic cleanup covers self-recreating caches and stale projects only',()=>fixture(async({home,finding})=>{
  const now=Date.parse('2026-10-08T00:00:00Z');const day=86400000;
  const project=async name=>{const dir=path.join(home,'code',name);await fs.mkdir(path.join(dir,'node_modules'),{recursive:true});await fs.writeFile(path.join(dir,'package.json'),'{}');return path.join(dir,'node_modules');};
  const jetbrains=path.join(home,'Library','Caches','JetBrains');await fs.mkdir(jetbrains,{recursive:true});
  const node={...finding,rule_id:'node-modules',metadata:{'package.json':'yes'}};
  const findings=[
    finding,
    {...node,path:await project('old'),last_modified:new Date(now-120*day).toISOString()},
    {...node,path:await project('active'),last_modified:new Date(now-5*day).toISOString()},
    {...node,path:await project('unknown'),last_modified:null},
    {...finding,rule_id:'jetbrains-caches',path:jetbrains},
    {...finding,severity:'REVIEW'},
  ];
  const p=await cleanup.prepare({findings},home,path.join(home,'app'),now);
  assert.deepEqual(p.report.findings.map(f=>f.auto_clean),[true,true,false,false,false,false]);
  assert.deepEqual(p.report.findings.map(f=>f.cleanup_allowed),[true,true,true,true,true,false]);
}));
test('review items can be selected by hand but never automatically; risky ones stay blocked with a reason',()=>fixture(async({home,finding})=>{
  const mk=async rel=>{const dir=path.join(home,rel);await fs.mkdir(dir,{recursive:true});return dir;};
  const review={...finding,severity:'REVIEW',reclaimable:false};
  const avd=await mk('.android/avd/Pixel.avd');await fs.writeFile(path.join(home,'.android/avd/Pixel.ini'),'path=');
  const appCacheFile=path.join(await mk('Library/Caches'),'thumb.png');await fs.writeFile(appCacheFile,'png');
  const findings=[
    {...review,rule_id:'android-avds',path:avd},
    {...review,rule_id:'user-app-caches',path:await mk('Library/Caches/com.spotify.client')},
    {...review,rule_id:'user-app-caches',path:appCacheFile},
    {...review,rule_id:'user-logs',path:await mk('Library/Logs/DiagnosticReports')},
    {...review,rule_id:'downloads',path:await mk('Downloads')},
    {...review,rule_id:'user-app-caches',path:await mk('Library/Caches/CloudKit'),size_complete:false},
    {...review,rule_id:'user-app-caches',path:await mk('Library/Caches/a/b')},
    {...review,rule_id:'android-avds',path:await mk('.android/avd/notes')},
    {...finding,rule_id:'node-modules',path:'/opt/homebrew/lib/node_modules',metadata:{'package.json':'yes'}},
  ];
  const p=await cleanup.prepare({findings},home,path.join(home,'app'));
  assert.deepEqual(p.report.findings.map(f=>f.cleanup_allowed),[true,true,true,true,false,false,false,false,false]);
  assert.ok(p.report.findings.filter(f=>f.cleanup_allowed).every(f=>f.cleanup_review && !f.auto_clean));
  assert.ok(p.report.findings.filter(f=>!f.cleanup_allowed).every(f=>f.cleanup_reason.length>10));
  const items=cleanup.select(p.report,[0,2],p.report.cleanup_token);const called=[];
  await cleanup.moveToTrash(items,p.manifest,async t=>called.push(t));
  assert.deepEqual(called,[avd,path.join(home,'.android/avd/Pixel.ini'),appCacheFile]);
}));
