"use strict";
const assert=require('node:assert/strict');const {Writable}=require('node:stream');
const {VideoPipeWriter}=require('../src/core/ndi/video-pipe-writer');const {FramePacer}=require('../src/core/playout/frame-pacer');
(async()=>{
 const delivered=[];let pacer,maxQueued=0;
 const sink=new Writable({highWaterMark:1,write(frame,_encoding,done){delivered.push(frame[0]);setTimeout(done,delivered.length%8===0?150:5);}});
 const writer=new VideoPipeWriter({onWritable:()=>pacer.resume(),onError:error=>assert.fail(error.message)});
 pacer=new FramePacer({profile:{fpsN:25,fpsD:1,frameSize:4096},source:{pause(){},resume(){}},reserveMs:80,onFrame:frame=>{const result=writer.write(sink,frame);maxQueued=Math.max(maxQueued,sink.writableLength);return result;}});
 try{
  for(let n=0;n<50;n++)pacer.push(Buffer.alloc(4096,n));
  await Promise.race([pacer.end(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Pipe did not resume')),6000))]);
  assert.deepEqual(delivered,Array.from({length:50},(_,n)=>n));assert(maxQueued<=4096,'PROGRAM must wait for drain rather than queue more frames or restart the sender');assert(writer.waits>=50);assert(writer.maxWaitMs>=100);
  console.log('VIDEO PIPE: repeated 150 ms native stalls preserve frame order, bounded queue, drain recovery and sender lifetime passed');
 }finally{pacer.stop();sink.destroy();writer.clear();}
})().catch(error=>{console.error(error);process.exitCode=1});
