'use strict';
const assert=require('node:assert/strict');
(async()=>{
 const {MonitorAudioTimeline}=await import('../src/renderer/src/monitor-audio-timeline.mjs');
 for(const rate of [44100,48000]){
  const t=new MonitorAudioTimeline(),frames=rate/50;let previous;
  for(let i=0;i<3000;i++){
   const at=t.plan({epoch:1,mediaTime:i*.02,frames,rate,deviceAt:10+i*.02+(i?Math.sin(i)*.025:0)});
   if(previous!==undefined)assert(Math.abs(at-previous-.02)<1e-10,'Device timestamp jitter must not create gaps or overlaps');
   previous=at;
  }
  const gap=t.plan({epoch:1,mediaTime:60.04,frames,rate,deviceAt:70.03});assert(Math.abs(gap-70.04)<1e-10);
  assert.equal(t.plan({epoch:1,mediaTime:60.06,frames,rate,deviceAt:71}),null);
  assert.equal(t.plan({epoch:2,mediaTime:0,frames,rate,deviceAt:100}),100);
  t.reset();assert.equal(t.plan({epoch:2,mediaTime:0,frames,rate,deviceAt:200}),200);
 }
 console.log('MONITOR AUDIO TIMELINE: 60s device jitter, contiguous PCM, genuine packet gaps, cuts and resets passed at 44.1/48 kHz');
})().catch(e=>{console.error(e);process.exitCode=1});
