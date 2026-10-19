"use strict";
const { Worker }=require('node:worker_threads'),fs=require('node:fs'),path=require('node:path');
const fingerprint=stat=>`${stat.size}:${stat.mtimeMs}:${stat.ino}`;
class MediaQualityQueue {
 constructor({ffmpeg,onUpdate,getMedia,canUseCached=()=>false}){Object.assign(this,{ffmpeg,onUpdate,getMedia,canUseCached});this.pending=new Map();this.running=null;this.stopped=false;this.completed=0;}
 enqueue(item){if(this.stopped||!item?.path||item.sourceType==='input'||item.placeholder||this.pending.has(item.id)||this.running?.item.id===item.id)return;
  this.pending.set(item.id,{...item});this.update(item.id,{version:1,status:'queued',error:null});this.pump();}
 update(id,quality){const current=this.getMedia().find(item=>item.id===id);if(current)try{if(["queued","checking"].includes(quality.status)){quality={...quality,blockedFingerprint:current.quality?.status==='rejected'?current.quality.fingerprint:current.quality?.blockedFingerprint};}this.onUpdate(id,quality)}catch(error){console.error('Estado da análise não confirmado:',error.message)}}
 pump(){if(this.stopped||this.running||!this.pending.size)return;const [id,item]=this.pending.entries().next().value;this.pending.delete(id);
  if(!this.getMedia().some(current=>current.id===id&&current.path===item.path)){this.pump();return;}
  this.update(id,{version:1,status:'checking',error:null});
  const worker=new Worker(path.join(__dirname,'quality-worker.js'),{workerData:{ffmpeg:this.ffmpeg,path:item.path,videoStreamIndex:item.videoStreamIndex,audioStreamIndex:item.audioStreamIndex,duration:item.duration}});
  const job=this.running={worker,item,pid:null,finished:false};
  const finish=quality=>{if(job.finished)return;job.finished=true;
   const current=this.getMedia().find(current=>current.id===id&&current.path===item.path);
   if(current&&!this.stopped)this.update(id,quality);this.completed++;};
  worker.on('message',message=>{if(message.type==='pid')job.pid=message.pid;if(message.type==='result'){job.gotResult=true;finish(message.quality)}});
  worker.on('error',error=>finish({version:1,status:'unavailable',error:error.message}));
  worker.once('exit',()=>{if(!job.gotResult&&job.pid)try{process.kill(job.pid,'SIGKILL')}catch{};finish({version:1,status:'unavailable',error:'A análise foi interrompida.'});if(this.running===job)this.running=null;this.pump()});
 }
 async inspect(item){if(item.placeholder||item.sourceType==='input')return {status:'live'};
  const current=this.getMedia().find(current=>current.id===(item.sourceMediaId||item.id));if(!current)throw Error(`Material não cadastrado: ${item.name}`);
  let stat;try{stat=await fs.promises.stat(current.path)}catch(error){if(current.quality?.status==='approved'&&this.canUseCached(current.path))return current.quality;throw error;}const valid=current.quality?.version===1&&current.quality.fingerprint===fingerprint(stat);
  if(valid&&current.quality.status==='approved')return current.quality;
  if((valid&&current.quality?.status==='rejected')||current.quality?.blockedFingerprint===fingerprint(stat))throw Error(`Material reprovado: ${current.name}. ${current.quality.error||''}`);
  this.enqueue(current);throw Error(`Análise completa pendente: ${current.name}. Aguarde a aprovação ${current.scheduleOnly ? 'do arquivo da programação' : 'na Biblioteca'} antes de aplicar.`);
 }
 async assertPlayable(item){const q=item.quality;if(!q||(!q.blockedFingerprint&&q.status!=="rejected"))return;
  const stat=await fs.promises.stat(item.path);if((q.status==="rejected"&&q.fingerprint===fingerprint(stat))||q.blockedFingerprint===fingerprint(stat))throw Error("Material reprovado na análise completa: "+(q.error||item.name));this.enqueue(item);}
 async validate(items){for(const item of items)await this.inspect(item);}
 snapshot(){return {queued:this.pending.size,running:this.running?.item.id||null,completed:this.completed};}
 async stop(){this.stopped=true;this.pending.clear();const job=this.running;if(!job)return;job.worker.postMessage('cancel');
  await new Promise(resolve=>{let timer;const done=()=>{clearTimeout(timer);resolve()};job.worker.once('exit',done);timer=setTimeout(()=>{if(job.pid)try{process.kill(job.pid,'SIGKILL')}catch{};void job.worker.terminate().finally(done)},1500)});}
}
module.exports={MediaQualityQueue,fingerprint};
