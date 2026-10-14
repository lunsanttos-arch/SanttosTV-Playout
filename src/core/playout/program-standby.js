"use strict";
const { performance } = require("node:perf_hooks");
function blackFrame(profile) {
    const frame=Buffer.alloc(profile.frameSize);
    if(profile.ndiPixelFormat==="i420") { const y=profile.width*profile.height;frame.fill(16,0,y);frame.fill(128,y); }
    else if(profile.ndiPixelFormat==="uyvy")for(let i=0;i<frame.length;i+=4){frame[i]=128;frame[i+1]=16;frame[i+2]=128;frame[i+3]=16;}
    else for(let i=3;i<frame.length;i+=4)frame[i]=255;
    return frame;
}
class ProgramStandby {
    constructor({getProfile,isPlaying,getFrame,onFrame,onAudio}){Object.assign(this,{getProfile,isPlaying,getFrame,onFrame,onAudio});this.frames=0;this.samples=0;this.signature="";this.timer=null;}
    start(){let deadline=performance.now();const tick=()=>{const p=this.getProfile();const signature=[p.width,p.height,p.ndiPixelFormat,p.sampleRate,p.channels,p.fpsN,p.fpsD].join("|");if(this.signature!==signature){this.signature=signature;this.black=blackFrame(p);this.frames=0;this.samples=0;deadline=performance.now();}
        if(!this.isPlaying()) { const next=Math.floor(++this.frames*p.sampleRate*p.fpsD/p.fpsN),count=next-this.samples;this.samples=next;
            this.onFrame(this.getFrame()||this.black);this.onAudio(Buffer.alloc(count*p.channels*4),p.sampleRate,p.channels); }
        const period=1000*p.fpsD/p.fpsN;deadline=Math.max(deadline+period,performance.now()+period/2);
        this.timer=setTimeout(tick,Math.max(0,deadline-performance.now()));this.timer.unref();};tick();}
    stop(){clearTimeout(this.timer);}
}
module.exports={blackFrame,ProgramStandby};
