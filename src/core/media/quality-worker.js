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
 async function decode(strict) { return new Promise((resolve,reject)=>{
  let tail='',stderr='',frames=0,completed=false,progressEnd=false,lastSeconds=0,logOverflow=false;
  const args=['-hide_banner','-loglevel','error','-nostdin','-nostats',...(strict?['-xerror','-err_detect','explode']:[]),'-threads','1','-filter_threads','1','-filter_complex_threads','1','-i',workerData.path,
   '-map',Number.isSafeInteger(workerData.videoStreamIndex)?`0:${workerData.videoStreamIndex}`:'0:v:0','-map','0:a?','-sn','-dn','-threads','1','-progress','pipe:1','-f','null','-'];
  child=spawn(workerData.ffmpeg,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});
  parentPort.postMessage({type:'pid',pid:child.pid});
  try{os.setPriority(child.pid,os.constants.priority.PRIORITY_BELOW_NORMAL)}catch{}
  let lastProgress=Date.now();const timer=setInterval(()=>{if(Date.now()-lastProgress>60000)finish(Error('Análise sem progresso por 60 segundos.'));},1000);
  const deadline=setTimeout(()=>finish(Error('A análise completa excedeu o prazo.')),Math.max(60000,Math.min(86400000,((workerData.duration||300)*3+120)*1000)));
  function finish(error){if(completed)return;completed=true;clearInterval(timer);clearTimeout(deadline);if(error){const target=child;if(target.exitCode===null&&target.signalCode===null){target.kill();const kill=setTimeout(()=>target.kill('SIGKILL'),1000);kill.unref();target.once('close',()=>clearTimeout(kill));}reject(error)}else resolve({frames,stderr,progressEnd,lastSeconds,logOverflow});}
  child.stdout.on('data',chunk=>{lastProgress=Date.now();tail+=chunk.toString();const lines=tail.split(/\r?\n/);tail=lines.pop();for(const line of lines){if(line.startsWith('frame='))frames=Math.max(frames,Number(line.slice(6))||0);if(line==='progress=end')progressEnd=true;if(line.startsWith('out_time_us='))lastSeconds=Number(line.slice(12))/1000000;}});
  child.stderr.on('data',chunk=>{const next=stderr+chunk.toString();if(next.length>4000)logOverflow=true;stderr=next.slice(-4000);});
  child.on('error',finish);child.on('close',(code,signal)=>finish(canceled?Error('Análise cancelada.'):code!==0||signal||!frames?Error(stderr||'O arquivo não entregou vídeo até o fim da análise.'):null));
 }); }
 let decoded, recovery=null;
 try { decoded=await decode(true); } catch (strictError) {
  if(canceled || !/missing picture in access unit with size (?:[1-9]|[12][0-9]|3[0-2])(?:\D|$)/.test(strictError.message))throw strictError;
  const probe=await require('./ffprobe').runProbe(workerData.path,{onChild:process=>{child=process;parentPort.postMessage({type:'pid',pid:process.pid});try{os.setPriority(process.pid,os.constants.priority.PRIORITY_BELOW_NORMAL)}catch{};if(canceled)process.kill();}});
  if(canceled)throw Error('Análise cancelada.');
  const video=probe.streams?.find(item=>Number.isSafeInteger(workerData.videoStreamIndex)?item.index===workerData.videoStreamIndex:item.codec_type==='video'&&!item.disposition?.attached_pic);
  const expected=Number(video?.nb_frames),duration=Number(video?.duration);
  decoded=await decode(false);
  recovery=require('./quality-recovery').assessRecovery({ ...decoded,expected,duration });
  if(!recovery)throw Error('Falha de decodificação além do limite de recuperação pontual. '+decoded.stderr);
 }
 const frames=decoded.frames;
 const loudness=await require('./loudness-analysis').analyzeLoudness({ffmpeg:workerData.ffmpeg,file:workerData.path,
  audioStreamIndex:workerData.audioStreamIndex,duration:workerData.duration,isCanceled:()=>canceled,
  onChild:process=>{child=process;parentPort.postMessage({type:'pid',pid:process.pid});}});
 if(loudness.status!=='no-audio')loudness.mono=await require('./loudness-analysis').analyzeLoudness({ffmpeg:workerData.ffmpeg,file:workerData.path,
  channels:1,audioStreamIndex:workerData.audioStreamIndex,duration:workerData.duration,isCanceled:()=>canceled,
  onChild:process=>{child=process;parentPort.postMessage({type:'pid',pid:process.pid});}});
 const hash=crypto.createHash('sha256');stream=fs.createReadStream(workerData.path,{highWaterMark:256*1024});
 for await(const chunk of stream){if(canceled)throw Error('Análise cancelada.');hash.update(chunk);}
 const after=await fs.promises.stat(workerData.path);
 if(fingerprint(before)!==fingerprint(after))throw Object.assign(Error('O arquivo mudou durante a análise; verifique novamente.'),{code:'CHANGED'});
 parentPort.postMessage({type:'result',quality:{version:1,policyVersion:2,status:'approved',warning:recovery?'Reproduzível com ressalva: unidade H.264 inválida recuperada na leitura completa.':null,recovery,fingerprint:fingerprint(after),sha256:hash.digest('hex'),frames,loudness,checkedAt:new Date().toISOString(),error:null}});
})().catch(error=>parentPort.postMessage({type:'result',quality:{version:1,policyVersion:2,fingerprint:originalFingerprint,status:['ENOENT','EACCES','EPERM','CHANGED'].includes(error.code)?'unavailable':'rejected',error:String(error.message).slice(-1600),checkedAt:new Date().toISOString()}})).finally(()=>parentPort.close());
