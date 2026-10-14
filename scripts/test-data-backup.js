const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const {DataBackupManager,DataBackupService,applyPendingRestore,decodeBackup,FILES}=require('../src/core/backup/data-backup');
(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'santtos-data-backup-'));try{
 const data=path.join(root,'user'),external=path.join(root,'external');fs.mkdirSync(path.join(data,'database'),{recursive:true});
 const original={settings:{channelName:'Original'},media:[{id:'media',path:'C:\\media\\video.mp4'}],timeline:[{id:'occurrence'}],dailyRundowns:{}};
 fs.writeFileSync(path.join(data,FILES[0]),JSON.stringify(original));fs.writeFileSync(path.join(data,FILES[1]),JSON.stringify({categories:[]}));fs.mkdirSync(path.join(data,'reporting'),{recursive:true});fs.writeFileSync(path.join(data,FILES[4]),'{}');
 const manager=new DataBackupManager(data,'1.0.0');assert.throws(()=>manager.create(),/inválidos/);
 fs.mkdirSync(path.join(data,'reporting'),{recursive:true});fs.writeFileSync(path.join(data,FILES[4]),JSON.stringify({entries:[{id:'report'}]}));
 fs.writeFileSync(path.join(data,FILES[6]),JSON.stringify({itemId:'occurrence',positionSeconds:12,playing:true}));
 fs.writeFileSync(path.join(data,'video.mp4'),'NEVER BACK UP VIDEO');fs.mkdirSync(path.join(data,'cache'));fs.writeFileSync(path.join(data,'cache','video.mp4'),'CACHE');
 manager.configure({keep:5,additionalFolder:external});for(let i=0;i<7;i++)manager.create();
 const local=fs.readdirSync(manager.local).filter(n=>n.endsWith('.santtos-backup'));assert.equal(local.length,5);assert.equal(fs.readdirSync(external).length,5);
 fs.writeFileSync(path.join(manager.local,'manual.santtos-backup'),'KEEP MANUAL');manager.create();assert(fs.existsSync(path.join(manager.local,'manual.santtos-backup')));
 const exported=path.join(root,'export.santtos-backup');manager.export(exported);const decoded=decodeBackup(exported);assert.equal(decoded.info.mediaCount,1);assert(!decoded.info.files.some(n=>n.endsWith('.mp4')));assert.equal(decoded.files.size,4);
 // Additional storage failure cannot invalidate a completed local copy.
 const bad=path.join(root,'not-directory');fs.writeFileSync(bad,'x');manager.configure({additionalFolder:bad});const fallback=manager.create();assert(fallback.ok&&fallback.warning&&fs.existsSync(fallback.file));
 // Reject traversal, incompatible data, checksum changes and duplicate entries before staging.
 const contents=JSON.parse(zlib.gunzipSync(fs.readFileSync(exported)));
 for(const mutate of [p=>p.files[0].name='../outside.json',p=>p.files[0].sha256='broken',p=>p.files.push(p.files[0]),p=>p.version=999]){
  const payload=structuredClone(contents);mutate(payload);const badFile=path.join(root,'bad.santtos-backup');fs.writeFileSync(badFile,zlib.gzipSync(JSON.stringify(payload)));assert.throws(()=>manager.stage(badFile));assert(!fs.existsSync(path.join(data,'pending-data-restore.santtos-backup')));
 }
 fs.writeFileSync(path.join(data,FILES[0]),JSON.stringify({...original,settings:{channelName:'Changed'}}));manager.stage(exported);assert(applyPendingRestore(data));assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data,FILES[0]))),original);assert.equal(JSON.parse(fs.readFileSync(path.join(data,FILES[6]))).playing,false);assert(fs.existsSync(path.join(data,'data-restore-rollback',FILES[0])));assert(!applyPendingRestore(data));
 // Interrupted application: recover prior files before retrying the pending valid archive.
 manager.stage(exported);fs.writeFileSync(path.join(data,FILES[0]),'partial corrupt write');fs.writeFileSync(path.join(data,'data-restore-journal.json'),'{"version":1}');assert(applyPendingRestore(data));assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data,FILES[0]))),original);
 const service=new DataBackupService(data,'1.0.0');assert((await service.run('status')).settings.keep===5);await service.run('create');service.stop();
 console.log('DATA BACKUP: allowlist, no videos/cache, retention, optional storage failure, checksum/schema rejection, stopped recovery, rollback journal and background worker passed');
}finally{fs.rmSync(root,{recursive:true,force:true})}})().catch(error=>{console.error(error);process.exitCode=1});
