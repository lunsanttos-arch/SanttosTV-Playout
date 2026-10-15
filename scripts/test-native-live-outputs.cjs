"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn,execFileSync}=require('node:child_process');const {resolveMediaRuntime}=require('../src/core/media/runtime-paths');const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const pages=await(await fetch('http://127.0.0.1:9333/json')).json();const ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let serial=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);pending.get(m.id)?.(m);pending.delete(m.id);});
 async function evaluate(expression){const id=++serial;let timeout;const result=new Promise((r,j)=>{pending.set(id,r);timeout=setTimeout(()=>j(Error('Live output QA timeout')),15000);});ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));try{const m=await result;if(m.result?.exceptionDetails)throw Error(m.result.exceptionDetails.exception?.description);return m.result.result.value;}finally{clearTimeout(timeout);pending.delete(id);}}
 const call=(method,...args)=>evaluate(`window.santtosAPI.${method}(...${JSON.stringify(args)})`);
 const state=await call('getNdiStatus');assert(state.devNullSink&&!state.testBench);
 const original=await call('getSettings'),prior=await call('getTimeline'),media=(await call('getMedia'))[0];
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'santtos-live-output-')),file=path.join(root,'received.ts');let receiver;
 try{
  await call('stopNdiFile');
  const items=[{...media,id:'hot-output-first',sourceMediaId:media.id,inPoint:0,outPoint:12,loop:false,freezeEnd:false},{...media,id:'hot-output-next',sourceMediaId:media.id,inPoint:12,outPoint:20,loop:false,freezeEnd:false}];
  await call('applyNativeRundown',items);await call('playNdiFile',media.path,0,'',{itemId:items[0].id,inPointSeconds:0,outPointSeconds:12});
  const before=await call('getNdiStatus');const sameDecoder=async()=>{const current=await call('getNdiStatus');assert.equal(current.playout.generation,before.playout.generation);assert.equal(current.decks.active.pid,before.decks.active.pid);assert.equal(current.playout.state,'PLAYING');return current;};
  const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
  receiver=spawn(resolveMediaRuntime('ffmpeg'),['-hide_banner','-loglevel','error','-analyzeduration','500000','-probesize','32768','-i',`srt://127.0.0.1:${port}?mode=listener`,'-map','0:v','-map','0:a','-c','copy','-y',file],{stdio:['ignore','ignore','pipe']});let error='';receiver.stderr.on('data',c=>error+=c);const closed=new Promise(r=>receiver.once('close',r));await wait(200);
  let output={...original.output,ndi:{...original.output.ndi,enabled:false},srt:{...original.output.srt,enabled:true,host:'127.0.0.1',port,mode:'caller',passphrase:'',streamId:''}};
  assert((await call('saveOutputSettings',output)).ok);await sameDecoder();
  let connected=false;for(let n=0;n<40;n++){const status=await sameDecoder();if(status.transports.srt?.online){connected=true;break;}await wait(100);}assert(connected,error);
  output={...output,ndi:{enabled:true,name:'Hot configuration QA'}};assert((await call('saveOutputSettings',output)).ok);await sameDecoder();await wait(1500);
  output={...output,srt:{...output.srt,enabled:false},resolution:'720x480',fps:'30'};
  const saved=await call('saveOutputSettings',output);assert(saved.ok&&saved.pendingProfile,'Raster changes must queue for CUT while destinations apply live');
  const held=await sameDecoder();assert.equal(held.profile.resolution,before.profile.resolution);assert(held.playout.positionSeconds>before.playout.positionSeconds);
  receiver.kill('SIGINT');await Promise.race([closed,wait(1500)]);const streams=JSON.parse(execFileSync(resolveMediaRuntime('ffprobe'),['-v','error','-show_streams','-of','json',file],{encoding:'utf8'})).streams;assert(streams.some(s=>s.codec_name==='h264'));assert(streams.some(s=>s.codec_name==='aac'));
  let cut=false;for(let n=0;n<120;n++){const status=await call('getNdiStatus');if(status.playout.itemId===items[1].id&&status.playout.state==='PLAYING'){assert.equal(status.profile.resolution,'720x480');assert.equal(status.profile.fpsText,'30');cut=true;break;}await wait(100);}assert(cut,'Next prepared CUT must apply the new technical profile automatically');
  console.log('LIVE OUTPUTS: NDI off/on/name and SRT start/stop preserve PROGRAM decoder/generation/position; real H.264/AAC received; new raster applies only at next A/B CUT passed');
 }finally{await call('stopNdiFile').catch(()=>{});await call('saveOutputSettings',original.output).catch(()=>{});await call('saveTimeline',prior).catch(()=>{});receiver?.kill('SIGKILL');ws.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
