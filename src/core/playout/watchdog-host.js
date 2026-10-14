"use strict";
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),{performance}=require('node:perf_hooks');
let config=null,last=performance.now(),stopping=false,restarting=false;
function restart(reason){if(stopping||restarting||!config)return;restarting=true;
 try{fs.mkdirSync(config.folder,{recursive:true});fs.writeFileSync(path.join(config.folder,'last-watchdog-restart.json'),JSON.stringify({createdAt:new Date().toISOString(),reason}));}catch{}
 if(reason==='heartbeat-expired'){try{process.kill(config.parentPid)}catch{}}
 setTimeout(()=>{const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const child=spawn(config.execPath,config.args,{cwd:config.cwd,env,detached:true,windowsHide:false,stdio:'ignore'});child.on('error',()=>process.exit(1));child.once('spawn',()=>{child.unref();process.exit(0)})},300);}
process.on('message',message=>{if(message?.type==='init'){config=message;last=performance.now()}else if(message?.type==='heartbeat')last=performance.now();else if(message?.type==='stop'){stopping=true;process.exit(0)}});
process.on('disconnect',()=>restart('parent-exited'));
setInterval(()=>{if(config&&performance.now()-last>config.timeoutMs)restart('heartbeat-expired')},1000);
