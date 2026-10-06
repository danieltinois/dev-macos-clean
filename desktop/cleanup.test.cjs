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
