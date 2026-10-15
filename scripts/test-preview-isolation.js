"use strict";
const assert=require('node:assert/strict');const {DecoderDeck}=require('../src/core/playout/decoder-deck');
(async()=>{
 let finish,frames=0;const ended=new Promise(resolve=>finish=resolve);
 // A muxer writes a burst of future JPEG before its next raw frame. Pausing
 // pipe 3 deadlocks the entire producer even though PROGRAM itself is writable.
 const producer=`(async()=>{const fs=require('node:fs');const jpeg=Buffer.alloc(100000,1);jpeg[0]=255;jpeg[1]=216;jpeg[jpeg.length-2]=255;jpeg[jpeg.length-1]=217;for(let n=0;n<128;n++)await new Promise((r,j)=>fs.write(3,jpeg,e=>e?j(e):r()));for(let n=0;n<50;n++)process.stdout.write(Buffer.alloc(16,n));})().catch(()=>process.exit(1));`;
 const deck=new DecoderDeck({executable:process.execPath,args:['-e',producer],profile:{frameSize:16,fpsN:25,fpsD:1,sampleRate:48000,channels:2},graphics:{attach(){},stop(){}},source:{cleanup(){}},requireAudio:false,duration:2,remote:false,timeoutMs:1500,onFrame:()=>frames++,onPreview(){},onFirst(){},onFinish:finish,createAudio:stream=>{stream.resume();return {stop(){}};}});
 try{await deck.ready;const status=deck.snapshot();assert(status.droppedPreviewFrames>0);assert(status.bufferedPreviewFrames<=64);assert(status.bufferedPreviewBytes<=8*1024*1024);await deck.activate();assert.equal(await ended,null);assert.equal(frames,50);console.log('PREVIEW ISOLATION: 12 MB JPEG burst drains without blocking PROGRAM; preview bounds, EOF and 50 delivered video frames passed');}finally{deck.stop();}
})().catch(error=>{console.error(error);process.exitCode=1});
