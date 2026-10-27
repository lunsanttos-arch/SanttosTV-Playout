'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const db=require('../src/database/database');
const {JsonStore,flushPersistence,closePersistence}=require('../src/core/persistence/json-store');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'santtos-publication-'));
 const originalFlush=JsonStore.prototype.flush;let release;
 try{
  db.initializeDatabase({userDataPath:root,migrateLegacy:false});
  const file=path.join(root,'clip.mp4');fs.writeFileSync(file,'fixture');
  const source=db.addMedia([file]).importedItems[0];
  db.updateMediaMetadata(source.id,{duration:40});
  const old={...source,id:'old-air',sourceMediaId:source.id,inPoint:0,outPoint:10};
  const next={...old,id:'new-grade',inPoint:10,outPoint:20};
  db.saveTimeline([old]);await flushPersistence();
  let acknowledge;const entered=new Promise(resolve=>{acknowledge=resolve});
  const gate=new Promise(resolve=>{release=resolve});
  JsonStore.prototype.flush=async function(){await originalFlush.call(this);acknowledge();await gate;};
  const publishing=db.publishTimeline([old,next]);
  await entered;
  assert.deepEqual(db.getTimeline().map(item=>item.id),['old-air'],'PROGRAM must keep old queue before disk ACK');
  assert.throws(()=>db.saveTimeline([]),/Aguarde/);
  await assert.rejects(()=>db.publishTimeline([]),/Aguarde/);
  assert.throws(()=>db.removeMedia(source.id),/Aguarde/);
  const disk=path.join(root,'database','santtos-tv.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(disk)).timeline.map(item=>item.id),['old-air','new-grade']);
  release();await publishing;JsonStore.prototype.flush=originalFlush;
  assert.deepEqual(db.getTimeline().map(item=>item.id),['old-air','new-grade']);
  // Real write failure: replace the database directory by a file temporarily.
  const folder=path.join(root,'database'),saved=folder+'-saved';
  fs.renameSync(folder,saved);fs.writeFileSync(folder,'not a directory');
  await assert.rejects(()=>db.publishTimeline([next]),/ENOTDIR|EEXIST/);
  assert.deepEqual(db.getTimeline().map(item=>item.id),['old-air','new-grade'],'Failed write must not activate candidate');
  fs.unlinkSync(folder);fs.renameSync(saved,folder);
  await flushPersistence({retry:true});
  assert.deepEqual(JSON.parse(fs.readFileSync(disk)).timeline.map(item=>item.id),['old-air','new-grade'],'Retry must not resurrect rejected candidate');
  await assert.rejects(()=>db.publishTimeline([{...next,sourceMediaId:'missing'}]),/não cadastrados/);
  await flushPersistence();await closePersistence();db.initializeDatabase({userDataPath:root,migrateLegacy:false});
  assert.deepEqual(db.getTimeline().map(item=>item.id),['old-air','new-grade'],'Restart restores last complete publication');
  await db.publishTimeline([]);assert.equal(db.getTimeline().length,0);
  console.log('SAFE PUBLICATION: real atomic writer, ACK barrier, concurrent edits blocked, real disk failure preserves queue, retry/restart and explicit clear passed');
 }finally{release?.();JsonStore.prototype.flush=originalFlush;await closePersistence();fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1});
