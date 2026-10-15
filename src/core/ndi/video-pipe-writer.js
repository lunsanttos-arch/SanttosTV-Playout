"use strict";
// A full native pipe is flow control, not a reason to restart the NDI sender.
class VideoPipeWriter {
    constructor({onWritable, onError}) { Object.assign(this,{onWritable,onError}); this.sink=null; this.blocked=false; this.waits=0; this.maxWaitMs=0; }
    clear() { if(this.sink && this.release) { this.sink.off('drain',this.release); this.sink.off('close',this.release); } this.blocked=false; }
    write(sink, frame) {
        if (!sink || sink.destroyed) return true;
        if (this.sink !== sink) { this.clear(); this.sink=sink; }
        try {
            const writable=sink.write(frame,error=>{if(error)this.onError(error,sink);});
            if(!writable && !this.blocked) {
                this.blocked=true;this.waits++;const started=performance.now();
                this.release=()=>{this.maxWaitMs=Math.max(this.maxWaitMs,performance.now()-started);this.clear();this.onWritable();};
                sink.once('drain',this.release);sink.once('close',this.release);
            }
            return writable;
        } catch(error) {this.onError(error,sink);return true;}
    }
    snapshot(){return {blocked:this.blocked,waits:this.waits,maxWaitMs:this.maxWaitMs,queuedBytes:this.sink?.writableLength||0};}
}
module.exports={VideoPipeWriter};
