"use strict";
const net=require('node:net');
class ProgramAudioRouter {
    constructor({onOverload=null,onConnected=null}={}){this.onOverload=onOverload;this.onConnected=onConnected;this.socket=null;this.pipe="";this.timer=null;this.connected=false;this.droppedBytes=0;this.bytes=0;this.stopped=false;}
    setPipe(pipe){if(pipe===this.pipe)return;this.pipe=pipe;clearTimeout(this.timer);this.socket?.destroy();this.socket=null;this.connected=false;this.connect();}
    connect(){if(this.stopped||!this.pipe||this.socket)return;const socket=net.createConnection(this.pipe);this.socket=socket;
        socket.on('connect',()=>{if(this.socket===socket){this.connected=true;this.onConnected?.()}});socket.on('error',()=>{});socket.on('close',()=>{if(this.socket!==socket)return;this.socket=null;this.connected=false;
            if(!this.stopped&&this.pipe){this.timer=setTimeout(()=>this.connect(),1000);this.timer.unref()}});}
    write(pcm){if(!this.connected||!this.socket||this.socket.destroyed)return false; if(this.socket.writableLength>192*1024){this.droppedBytes+=pcm.length;this.onOverload?.();return false;}this.bytes+=pcm.length;this.socket.write(pcm);return true;}
    stop(){this.stopped=true;clearTimeout(this.timer);this.timer=null;this.pipe="";this.socket?.destroy();this.socket=null;this.connected=false;}
}
module.exports={ProgramAudioRouter};
