const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {PlayoutRecovery}=require('../src/core/playout/playout-recovery');
(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'santtos-async-checkpoint-'));try{
const recovery=new PlayoutRecovery(root);const waiting=[];for(let n=0;n<100;n++)waiting.push(recovery.saveAsync({itemId:'latest',positionSeconds:n,playing:true}));await Promise.all(waiting);assert.equal(new PlayoutRecovery(root).state.positionSeconds,99);
await recovery.captureNativeAsync({itemId:'latest',positionSeconds:99.5,state:'PAUSED'});await recovery.flush();assert.equal(new PlayoutRecovery(root).state.playing,false);
await assert.rejects(async()=>recovery.saveAsync({itemId:'latest',positionSeconds:NaN}));
fs.writeFileSync(recovery.file,'broken');const restored=new PlayoutRecovery(root);assert.equal(restored.state.positionSeconds,99);await restored.saveAsync({itemId:'latest',positionSeconds:100,playing:false});assert.equal(JSON.parse(fs.readFileSync(restored.file+'.bak')).positionSeconds,99);
await restored.captureNativeAsync({itemId:'latest',positionSeconds:120,state:'ENDED'});assert.equal(new PlayoutRecovery(root).state.ended,true);assert.equal(new PlayoutRecovery(root).state.playing,false);
console.log('ASYNC CHECKPOINT: bounded coalescing, pause persistence, flush, invalid values and corrupt-primary recovery passed');
}finally{fs.rmSync(root,{recursive:true,force:true})}})().catch(error=>{console.error(error);process.exitCode=1});
