"use strict";
const assert=require('node:assert/strict');
const {Writable}=require('node:stream');
const {OmtOutput}=require('../src/core/omt/omt-output');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){for(let n=0;n<200;n++){if(predicate())return;await wait(5);}throw Error('OMT queue did not drain');}
function fixture(delay,frameBytes=1024*1024){
 const received=[];let maxQueued=0;
 const sink=new Writable({highWaterMark:1,write(frame,_encoding,done){received.push(frame.readUInt32LE(0));setTimeout(done,delay(received.length));}});
 const omt=new OmtOutput({profile:{omtEnabled:true},runtimeFolder:'.'});omt.process={stdin:sink,killed:false,kill(){this.killed=true;sink.destroy();}};omt.online=true;
 const send=n=>{const frame=Buffer.alloc(frameBytes);frame.writeUInt32LE(n);assert.equal(omt.writeVideo(frame),true,'Auxiliary OMT must not backpressure NDI');maxQueued=Math.max(maxQueued,sink.writableLength);assert(omt.snapshot().pendingVideoFrames<=1);};
 return {omt,sink,received,send,get maxQueued(){return maxQueued;}};
}
(async()=>{
 const normal=fixture(()=>1,1920*1080*4);
 try{for(let n=0;n<12;n++){normal.send(n);await wait(16);}await until(()=>!normal.omt.videoBlocked);assert.deepEqual(normal.received,Array.from({length:12},(_,n)=>n));assert.equal(normal.omt.videoFramesDropped,0);}finally{normal.omt.stop();}
 const slow=fixture(count=>count%3===0?150:35);
 try{
  for(let n=0;n<180;n++){slow.send(n);await wait(3);}
  await until(()=>!slow.omt.videoBlocked&&!slow.omt.pendingVideoFrame);
  assert.equal(slow.received[0],0);assert.equal(slow.received.at(-1),179,'Latest frame must flush on drain, without waiting for another PROGRAM frame');
  assert(slow.received.every((value,index)=>index===0||value>slow.received[index-1]));
  assert(slow.maxQueued<=1024*1024,'Only one whole video frame may be queued in the native pipe');
  assert.equal(slow.omt.videoFramesDropped,180-slow.received.length);assert(slow.omt.maxVideoWaitMs>=100);assert(!slow.omt.process.killed);
 }finally{slow.omt.stop();}
 const restart=fixture(()=>60);restart.send(1);restart.send(2);const old=restart.sink;
 restart.omt.stop();assert.equal(restart.omt.snapshot().pendingVideoFrames,0);old.emit('drain');assert.deepEqual(restart.received,[1],'Stop must invalidate unsent frames');
 console.log('OMT FLOW: normal cadence has no drops; repeated slow writes preserve latest frame, one-frame pipe bound, autonomous drain, exact discard accounting and stop isolation passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
