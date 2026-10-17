"use strict";
const { parentPort, workerData } = require('node:worker_threads');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), crypto = require('node:crypto'), os = require('node:os');
let child, stream, originalFingerprint, canceled=false;
parentPort.on('message',()=>{canceled=true;stream?.destroy(Error('Análise cancelada.'));child?.kill();});
const fingerprint=stat=>`${stat.size}:${stat.mtimeMs}:${stat.ino}`;
(async()=>{
 const before=await fs.promises.stat(workerData.path);
 if(canceled)throw Error('Análise cancelada.');
 if(!before.isFile())throw Error('A origem não é um arquivo.');
 originalFingerprint=fingerprint(before);
 const frames=await new Promise((resolve,reject)=>{
  let tail='',stderr='',frames=0,completed=false;
  const args=['-hide_banner','-loglevel','error','-nostdin','-nostats','-xerror','-err_detect','explode','-threads','1','-filter_threads','1','-filter_complex_threads','1','-i',workerData.path,
   '-map',Number.isSafeInteger(workerData.videoStreamIndex)?`0:${workerData.videoStreamIndex}`:'0:v:0','-map','0:a?','-sn','-dn','-threads','1','-progress','pipe:1','-f','null','-'];
  child=spawn(workerData.ffmpeg,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});
  parentPort.postMessage({type:'pid',pid:child.pid});
  try{os.setPriority(child.pid,os.constants.priority.PRIORITY_BELOW_NORMAL)}catch{}
  let lastProgress=Date.now();const timer=setInterval(()=>{if(Date.now()-lastProgress>60000)finish(Error('Análise sem progresso por 60 segundos.'));},1000);
  const deadline=setTimeout(()=>finish(Error('A análise completa excedeu o prazo.')),Math.max(60000,Math.min(86400000,((workerData.duration||300)*3+120)*1000)));
  function finish(error){if(completed)return;completed=true;clearInterval(timer);clearTimeout(deadline);if(error){child.kill();const kill=setTimeout(()=>child?.kill('SIGKILL'),1000);kill.unref();child.once('close',()=>clearTimeout(kill));reject(error)}else resolve(frames);}
  child.stdout.on('data',chunk=>{lastProgress=Date.now();tail+=chunk.toString();const lines=tail.split(/\r?\n/);tail=lines.pop();for(const line of lines)if(line.startsWith('frame='))frames=Math.max(frames,Number(line.slice(6))||0);});
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-4000);});
  child.on('error',finish);child.on('close',(code,signal)=>finish(canceled?Error('Análise cancelada.'):code!==0||signal||!frames?Error(stderr||'O arquivo não entregou vídeo até o fim da análise.'):null));
 });
 const hash=crypto.createHash('sha256');stream=fs.createReadStream(workerData.path,{highWaterMark:256*1024});
 for await(const chunk of stream){if(canceled)throw Error('Análise cancelada.');hash.update(chunk);}
 const after=await fs.promises.stat(workerData.path);
 if(fingerprint(before)!==fingerprint(after))throw Object.assign(Error('O arquivo mudou durante a análise; verifique novamente.'),{code:'CHANGED'});
 parentPort.postMessage({type:'result',quality:{version:1,status:'approved',fingerprint:fingerprint(after),sha256:hash.digest('hex'),frames,checkedAt:new Date().toISOString(),error:null}});
})().catch(error=>parentPort.postMessage({type:'result',quality:{version:1,fingerprint:originalFingerprint,status:['ENOENT','EACCES','EPERM','CHANGED'].includes(error.code)?'unavailable':'rejected',error:String(error.message).slice(-1600),checkedAt:new Date().toISOString()}})).finally(()=>parentPort.close());
