"use strict";
const { performance }=require('node:perf_hooks');
const { VideoPipeWriter }=require('../ndi/video-pipe-writer');
// NDI's FIFO is local to that destination. PROGRAM never waits for its drain.
// PCM may only advance through video actually accepted by this destination.
class IsolatedAvRoute {
 constructor({sendAudio,onFault,maxQueueMs=250,maxVideoBytes=64*1024*1024,stallMs=750}){
  Object.assign(this,{sendAudio,onFault,maxQueueMs,maxVideoBytes,stallMs});
  this.queue=[];this.audio=[];this.sink=null;this.profile=null;this.videoBytes=0;this.audioBytes=0;
  this.acceptedAudioBytes=0;this.sentAudioBytes=0;this.frames=0;this.faults=0;this.discardedFrames=0;this.lastError=null;this.maxPendingFrames=0;
  this.writer=new VideoPipeWriter({onWritable:()=>this.drain(),onError:(error,sink)=>{if(this.sink===sink)this.fail(error.message)}});
 }
 configure(profile){const signature=[profile.frameSize,profile.fpsN,profile.fpsD,profile.sampleRate,profile.channels].join('|');if(signature!==this.signature){this.reset();this.signature=signature;this.profile=profile;}}
 reset(){clearTimeout(this.timer);this.timer=null;this.writer.clear();this.writer.sink=null;this.sink=null;
  this.discardedFrames+=this.queue.length;this.queue=[];this.audio=[];this.videoBytes=0;this.audioBytes=0;this.acceptedAudioBytes=0;this.sentAudioBytes=0;this.sessionFrames=0;}
 write(sink,frame,samples){if(!this.profile||!sink||sink.destroyed){if(this.sink)this.reset();return true;}
  if(this.sink!==sink){this.reset();this.sink=sink;this.lastError=null;}
  const p=this.profile;const frameNumber=this.sessionFrames++;
  const count=Number.isSafeInteger(samples)?samples:Math.floor((frameNumber+1)*p.sampleRate*p.fpsD/p.fpsN)-Math.floor(frameNumber*p.sampleRate*p.fpsD/p.fpsN);
  const entry={frame,audioBytes:count*p.channels*4};
  if(this.writer.blocked||this.queue.length){
   const limit=Math.max(2,Math.ceil(this.maxQueueMs*p.fpsN/(1000*p.fpsD)));
   if(this.queue.length>=limit||this.videoBytes+frame.length>this.maxVideoBytes){this.fail('NDI sem consumir: limite da fila de vídeo. Reconectando apenas esta saída.');return true;}
   this.queue.push(entry);this.videoBytes+=frame.length;this.maxPendingFrames=Math.max(this.maxPendingFrames,this.queue.length);
  }else this.submit(entry);
  return true;
 }
 submit(entry){if(!this.sink||this.sink.destroyed){this.reset();return;}this.frames++;this.acceptedAudioBytes+=entry.audioBytes;
  this.writer.write(this.sink,entry.frame);this.flushAudio();
  if(this.writer.blocked&&!this.timer)this.timer=setTimeout(()=>this.fail('NDI sem consumir vídeo no prazo. Reconectando apenas esta saída.'),this.stallMs);}
 drain(){clearTimeout(this.timer);this.timer=null;if(this.sink?.destroyed){this.reset();return;}
  while(this.sink&&!this.writer.blocked&&this.queue.length){const entry=this.queue.shift();this.videoBytes-=entry.frame.length;this.submit(entry)}this.flushAudio();}
 writeAudio(chunk){if(!this.sink||!this.profile)return;
  const limit=Math.ceil(this.profile.sampleRate*this.profile.channels*4*1.5);
  if(this.audioBytes+chunk.length>limit){this.fail('NDI sem consumir áudio: limite da fila PCM. Reconectando áudio e vídeo desta saída.');return;}
  this.audio.push(chunk);this.audioBytes+=chunk.length;this.flushAudio();}
 flushAudio(){if(!this.sink)return;let budget=this.acceptedAudioBytes-this.sentAudioBytes;
  while(budget>0&&this.audio.length){const chunk=this.audio[0],length=Math.min(chunk.length,budget),packet=chunk.subarray(0,length);
   if(this.sendAudio(packet)!==true)return;
   this.sentAudioBytes+=length;this.audioBytes-=length;budget-=length;if(length===chunk.length)this.audio.shift();else this.audio[0]=chunk.subarray(length);}}
 fail(reason){if(!this.sink)return;this.lastError=reason;this.faults++;this.reset();this.onFault(reason);}
 snapshot(){return {...this.writer.snapshot(),isolated:true,frames:this.frames,pendingVideoFrames:this.queue.length,pendingVideoBytes:this.videoBytes,
  bufferedAudioBytes:this.audioBytes,acceptedAudioBytes:this.acceptedAudioBytes,sentAudioBytes:this.sentAudioBytes,maxPendingFrames:this.maxPendingFrames,
  faults:this.faults,discardedFrames:this.discardedFrames,lastError:this.lastError};}
}
module.exports={IsolatedAvRoute};
