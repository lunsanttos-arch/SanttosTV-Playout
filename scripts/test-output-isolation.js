'use strict';
const assert=require('node:assert/strict'),{Writable}=require('node:stream'),{spawn}=require('node:child_process');
const {IsolatedAvRoute}=require('../src/core/playout/isolated-av-route'),{FramePacer}=require('../src/core/playout/frame-pacer');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const audio=[],frames=[],p={fpsN:25,fpsD:1,frameSize:4096,sampleRate:48000,channels:2};
 const sink=new Writable({highWaterMark:1,write(frame,_,done){frames.push(frame[0]);setTimeout(done,45)}});
 const paired=new IsolatedAvRoute({sendAudio:chunk=>{audio.push(Buffer.from(chunk));return true},onFault:reason=>assert.fail(reason),maxQueueMs:500});paired.configure(p);
 for(let n=0;n<3;n++){paired.write(sink,Buffer.alloc(p.frameSize,n),1920);paired.writeAudio(Buffer.alloc(1920*8,n))}
 assert.equal(Buffer.concat(audio).length,1920*8,'PCM may not run ahead of video accepted by this sink');
 await wait(220);assert.deepEqual(frames,[0,1,2]);assert.equal(Buffer.concat(audio).length,3*1920*8);paired.reset();sink.destroy();
 // A real child process that never consumes stdin, not merely a mocked write return.
 const stuck=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['pipe','ignore','ignore']});stuck.stdin.on('error',()=>{});
 const faults=[],healthy=[],pcm=[];let pacer;
 const route=new IsolatedAvRoute({sendAudio:()=>true,onFault:reason=>{faults.push(reason);stuck.kill()},maxQueueMs:120,stallMs:400,maxVideoBytes:8*1024*1024});
 const profile={...p,frameSize:1024*1024};route.configure(profile);
 pacer=new FramePacer({profile,source:{pause(){},resume(){}},reserveMs:80,onFrame:frame=>{healthy.push({n:frame[0],at:performance.now()});const result=route.write(stuck.exitCode===null?stuck.stdin:null,frame,1920);route.writeAudio(Buffer.alloc(1920*8));pcm.push(1920);return result;}});
 try{for(let n=0;n<30;n++)pacer.push(Buffer.alloc(profile.frameSize,n));await pacer.end();
  assert.deepEqual(healthy.map(x=>x.n),Array.from({length:30},(_,n)=>n));assert.equal(pcm.length,30);assert.equal(faults.length,1);
  assert(route.snapshot().maxPendingFrames<=3);assert(healthy.at(-1).at-healthy[0].at<2000,'An unconsuming destination must not stop PROGRAM');assert.equal(pacer.snapshot().blocked,false);
  assert(faults[0].includes('NDI'));console.log('OUTPUT ISOLATION: real unconsuming child pipe, bounded destination queue, paired PCM budget, one local fault and 30 uninterrupted PROGRAM frames passed');
 }finally{pacer.stop();route.reset();stuck.kill();await new Promise(r=>{if(stuck.exitCode!==null||stuck.signalCode!==null)r();else stuck.once('exit',r)})}
})().catch(e=>{console.error(e);process.exitCode=1});
