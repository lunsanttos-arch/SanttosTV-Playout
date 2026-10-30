"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn,execFileSync}=require('node:child_process');const {TransportOutput}=require('../src/core/playout/transport-output');const {resolveMediaRuntime}=require('../src/core/media/runtime-paths');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const ffmpeg=resolveMediaRuntime('ffmpeg'),folder=fs.mkdtempSync(path.join(os.tmpdir(),'santtos-listener-')),file=path.join(folder,'received.ts');
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const profile={width:320,height:180,frameSize:320*180*4,ffmpegPixelFormat:'bgra',fpsN:25,fpsD:1,fpsExpression:'25/1',sampleRate:48000,channels:2};
 const output=new TransportOutput({ffmpegPath:ffmpeg,kind:'srt',profile,settings:{host:'127.0.0.1',port,mode:'listener',latencyMs:120}});
 let timer,receiver;try{
  output.start();const pid=output.process.pid;
  const frame=Buffer.alloc(profile.frameSize,80),pcm=Buffer.alloc(1920*8);for(let n=0;n<1920;n++){const v=Math.sin(n*2*Math.PI*1000/48000)*.1;pcm.writeFloatLE(v,n*8);pcm.writeFloatLE(v,n*8+4);}
  timer=setInterval(()=>{output.writeVideo(frame);output.writeAudio(pcm);},40);
  await wait(8000);assert.equal(output.process?.pid,pid,'Listener must stay bound while vMix has not connected');assert.equal(output.reconnects,0);assert(output.startupVideoFrames<=8);assert(output.process.stdin.writableLength<=profile.frameSize*8);
  receiver=spawn(ffmpeg,['-hide_banner','-loglevel','error','-analyzeduration','500000','-probesize','32768','-i',`srt://127.0.0.1:${port}?mode=caller`,'-map','0:v','-map','0:a','-c','copy','-y',file],{stdio:['pipe','ignore','pipe']});receiver.stdin.on('error',()=>{});let error='';receiver.stderr.on('data',c=>error+=c);const closed=new Promise(r=>receiver.once('close',r));
  for(let n=0;n<100&&!output.online;n++)await wait(100);
  assert(output.online,output.error||error);assert.equal(output.process.pid,pid);await wait(3500);receiver.stdin.end('q\n');let finishTimer;
  try { const code=await Promise.race([closed,new Promise((_,reject)=>{finishTimer=setTimeout(()=>reject(Error('SRT receiver did not flush')),8000)})]);assert([0,255].includes(code)); }
  finally { clearTimeout(finishTimer); }
  const info=JSON.parse(execFileSync(resolveMediaRuntime('ffprobe'),['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8'}));assert(info.streams.some(s=>s.codec_name==='h264'));assert(info.streams.some(s=>s.codec_name==='aac'));assert(Number(info.format.duration)>2);
  console.log('SRT LISTENER: eight seconds waiting for late vMix caller, bounded initial A/V, same encoder PID and H.264/AAC received passed');
 }finally{clearInterval(timer);output.stop();receiver?.kill('SIGKILL');fs.rmSync(folder,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
