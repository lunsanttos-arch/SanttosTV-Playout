"use strict";
const assert=require('node:assert/strict');const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const pages=await(await fetch('http://127.0.0.1:9333/json')).json();const ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let serial=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);pending.get(m.id)?.(m);pending.delete(m.id);});
 async function evaluate(expression){const id=++serial;const result=new Promise(r=>pending.set(id,r));ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));const reply=await result;if(reply.result?.exceptionDetails)throw Error(reply.result.exceptionDetails.exception?.description);return reply.result.result.value;}
 let prior;try{
  const status=await evaluate('window.santtosAPI.getNdiStatus()');assert(status.devNullSink&&!status.testBench);
  prior=await evaluate('window.santtosAPI.getTimeline()');await evaluate('window.santtosAPI.stopNdiFile()');
  const media=(await evaluate('window.santtosAPI.getMedia()'))[0];
  const item={...media,id:'cadence-loop',sourceMediaId:media.id,inPoint:0,outPoint:40,loop:true,freezeEnd:false};
  await evaluate(`window.santtosAPI.applyNativeRundown(${JSON.stringify([item])})`);
  await evaluate(`window.santtosAPI.playNdiFile(${JSON.stringify(media.path)},0,'',${JSON.stringify({itemId:item.id,inPointSeconds:0,outPointSeconds:40,loop:true})})`);
  let maxGap=0,maxLate=0,images=0,lastImage=null;const generations=new Set();
  const deadline=Date.now()+60000;
  while(Date.now()<deadline){await wait(500);const state=await evaluate('window.santtosAPI.getNdiStatus()');assert.equal(state.playoutError,null);if(state.decks.active){generations.add(state.playout.generation);maxGap=Math.max(maxGap,state.decks.active.pacing.maxGapMs);maxLate=Math.max(maxLate,state.decks.active.pacing.lateFrames);}
   const image=await evaluate(`document.querySelector('.program-native-preview-canvas')?.toDataURL()`);if(image&&image!==lastImage)images++;lastImage=image;
  }
  assert(generations.size>=2,'Cadence check must cross an actual prepared loop CUT');assert(images>=90,`Monitor froze: only ${images} changed samples in 60 s`);assert(maxGap<120,`PROGRAM cadence gap ${maxGap} ms`);assert(maxLate<12,`Frequent frame stalls: ${maxLate}`);
  console.log(`60S CADENCE: ${status.profile.resolution} ${status.profile.fpsText} fps video, ${generations.size} generations, ${images} changing canvas samples, max gap ${maxGap.toFixed(1)} ms, max late frames/deck ${maxLate} passed`);
 }finally{await evaluate('window.santtosAPI.stopNdiFile()').catch(()=>{});if(prior)await evaluate(`window.santtosAPI.saveTimeline(${JSON.stringify(prior)})`).catch(()=>{});ws.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
