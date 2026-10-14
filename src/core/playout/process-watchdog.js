"use strict";
const {fork}=require('node:child_process');const path=require('node:path');
class ProcessWatchdog {
 constructor({execPath,args=[],cwd,folder,timeoutMs=30000}){Object.assign(this,{execPath,args,cwd,folder,timeoutMs});this.child=null;this.timer=null;}
 start(){if(this.child)return;const child=fork(path.join(__dirname,'watchdog-host.js'),[],{execPath:this.execPath,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});this.child=child;
  child.on('error',error=>console.error('Supervisor externo:',error.message));child.on('exit',()=>{if(this.child===child){this.child=null;clearInterval(this.timer)}});
  child.send({type:'init',parentPid:process.pid,execPath:this.execPath,args:this.args,cwd:this.cwd,folder:this.folder,timeoutMs:this.timeoutMs});
  this.timer=setInterval(()=>{if(child.connected)child.send({type:'heartbeat'},()=>{})},1000);this.timer.unref();child.unref();}
 stop(){clearInterval(this.timer);const child=this.child;this.child=null;if(child){if(child.connected)child.send({type:'stop'},()=>{});child.kill();}}
}
module.exports={ProcessWatchdog};
