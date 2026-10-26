'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {MediaQualityQueue}=require('../src/core/media/quality-queue');const ffmpeg=require('../src/core/media/runtime-paths').resolveMediaRuntime('ffmpeg');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'santtos-quality-'));const good=path.join(root,'good.mp4'),bad=path.join(root,'bad.mp4');let queue;
try{
 execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=25','-f','lavfi','-i','sine=sample_rate=48000','-t','4','-c:v','libx264','-threads','1','-preset','ultrafast','-g','25','-c:a','aac','-movflags','+faststart','-y',good]);
 const bytes=fs.readFileSync(good),offset=Math.floor(bytes.length*.65);bytes.fill(0,offset,offset+4096);fs.writeFileSync(bad,bytes);
 const media=[{id:'good',path:good,name:'Good',duration:4,videoStreamIndex:0},{id:'bad',path:bad,name:'Bad',duration:4,videoStreamIndex:0}];let checking=0,maxChecking=0;
 queue=new MediaQualityQueue({ffmpeg,getMedia:()=>media,onUpdate:(id,quality)=>{media.find(m=>m.id===id).quality=quality;checking=media.filter(m=>m.quality?.status==='checking').length;maxChecking=Math.max(maxChecking,checking);}});
 for(const item of media)queue.enqueue(item);queue.enqueue(media[0]);
 async function done(){for(let i=0;i<300;i++){if(!queue.running&&!queue.pending.size)return;await wait(20)}throw Error('QC did not finish');}
 await assert.rejects(()=>queue.validate(media),/pendente/);await done();
 assert.equal(maxChecking,1);assert.equal(media[0].quality.status,'approved');assert.equal(media[0].quality.sha256.length,64);assert.equal(media[1].quality.status,'rejected');assert.equal(queue.completed,2);
 await queue.validate([media[0]]);await assert.rejects(()=>queue.validate([media[1]]),/reprovado/);await assert.rejects(()=>queue.assertPlayable(media[1]),/reprovado/);
 const missing={id:'gone',name:'Arquivo removido',path:path.join(root,'gone.mp4')};media.push(missing);
 await assert.rejects(()=>queue.validate([media[0],{...media[0],id:'occurrence',sourceMediaId:'good'},missing]),error=>error.message.startsWith('Item 3 — Arquivo removido: ENOENT:')&&error.cause.code==='ENOENT');
 media.pop();
 queue.enqueue(media[1]);await assert.rejects(()=>queue.assertPlayable(media[1]),/Análise em andamento/);await assert.rejects(()=>queue.validate([media[1]]),/Análise em andamento/);await done();assert.equal(media[1].quality.status,"rejected");
 fs.copyFileSync(good,bad);await assert.rejects(()=>queue.validate([media[1]]),/pendente/);await done();assert.equal(media[1].quality.status,'approved');await queue.validate([media[1]]);
 fs.appendFileSync(good,'modified');await assert.rejects(()=>queue.validate([media[0]]),/pendente/);await done();
 queue.enqueue({id:'missing',path:path.join(root,'gone.mp4')});await done(); // Unknown IDs never spawn jobs.
 queue.enqueue(media[0]);await queue.stop();assert.equal(queue.running,null);assert.equal(queue.pending.size,0);
 console.log('MEDIA QUALITY: real full video/audio decode, damaged middle rejected, SHA256, one job, no duplicate, approval invalidated by change, rejected recheck cannot bypass and corrected file approval passed');
}finally{await queue?.stop();fs.rmSync(root,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
