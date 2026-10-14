"use strict";
// Destructive QA of an explicitly isolated DEV NULL profile. Never production.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=process.env.SANTTOS_QA_USERDATA;
if(!root)throw Error('Set SANTTOS_QA_USERDATA to the isolated Electron userData folder.');
const wait=ms=>new Promise(r=>setTimeout(r,ms));let ws,serial=0;const pending=new Map();
async function connect(){const pages=await(await fetch('http://127.0.0.1:9333/json')).json();ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})});ws.addEventListener('message',e=>{const d=JSON.parse(e.data);pending.get(d.id)?.(d);pending.delete(d.id)})}
async function send(method,params={}){const id=++serial;let timer;const reply=new Promise(resolve=>pending.set(id,resolve));ws.send(JSON.stringify({id,method,params}));try{return await Promise.race([reply,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('CDP timeout: '+method)),5000)})])}finally{clearTimeout(timer);pending.delete(id)}}
async function evaluate(expression){const reply=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(reply.error||reply.result?.exceptionDetails)throw Error('Renderer not ready');return reply.result.result.value}
(async()=>{await connect();const status=await evaluate('window.santtosAPI.getNdiStatus()');assert(status.devNullSink&&!status.testBench,'Use DEV NULL only');
const backup=await evaluate('window.santtosAPI.getTimeline()');const source=(await evaluate('window.santtosAPI.getMedia()'))[0];assert(source&&source.duration>=12);
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'santtos-autonomy-')),badPath=path.join(folder,'removed.mp4');fs.copyFileSync(source.path,badPath);let badId;
const prefix='autonomy-'+Date.now();const reportFile=path.join(root,'reporting','playout-report-state.json');assert(fs.existsSync(reportFile));
try{await evaluate('window.santtosAPI.stopNdiFile()');await evaluate(`window.santtosAPI.importMedia(${JSON.stringify([badPath])})`);const bad=(await evaluate('window.santtosAPI.getMedia()')).find(item=>item.path===badPath);assert(bad);badId=bad.id;
const queue=[{...source,id:prefix+'-first',sourceMediaId:source.id,inPoint:0,outPoint:4,loop:false,freezeEnd:false},{...bad,id:prefix+'-bad',sourceMediaId:bad.id,inPoint:0,outPoint:4,loop:false,freezeEnd:false},{...source,id:prefix+'-next',sourceMediaId:source.id,inPoint:4,outPoint:10,loop:false,freezeEnd:false}];
await evaluate(`window.santtosAPI.applyNativeRundown(${JSON.stringify(queue)})`);fs.renameSync(badPath,badPath+'.gone');
await evaluate(`window.santtosAPI.playNdiFile(${JSON.stringify(source.path)},0,'',{itemId:${JSON.stringify(queue[0].id)},inPointSeconds:0,outPointSeconds:4,sourceType:'file'})`);
const first=(await evaluate('window.santtosAPI.getNdiStatus()')).playout;assert.equal(first.state,'PLAYING');
// Terminate the Chromium renderer while PROGRAM is on air. Main must reload it
// and advance past the removed file without any renderer request for Next.
void send('Page.crash').catch(()=>{});await wait(1600);
let next=false;const generations=new Set([first.generation]);for(let attempt=0;attempt<140;attempt++){try{if(ws.readyState!==WebSocket.OPEN)await connect();const state=(await evaluate('window.santtosAPI.getNdiStatus()')).playout;if(state.state==='PLAYING')generations.add(state.generation);if(state.itemId===queue[2].id&&state.state==='PLAYING')next=true;if(next&&state.state==='IDLE')break}catch{}await wait(100)}
assert(next,'PROGRAM must advance while renderer recovers');assert.equal(generations.size,2,'First and successor play once; removed clip never reaches PLAYING');
const entries=JSON.parse(fs.readFileSync(reportFile,'utf8')).entries.filter(entry=>entry.occurrenceId?.startsWith(prefix));
const failed=entries.find(entry=>entry.status==='PULADO_POR_ERRO');assert(failed,'Removed clip must be reported as skipped by error');assert(failed.errorReason&&failed.nextContent===source.name);assert.equal(entries.filter(entry=>entry.status==='EXECUTADO').length,2);
console.log('PROGRAM AUTONOMY: renderer crash/reload, automatic next, missing-file skip and backend report/successor passed');
}finally{try{await evaluate('window.santtosAPI.stopNdiFile()');await evaluate(`window.santtosAPI.saveTimeline(${JSON.stringify(backup)})`);if(backup[0])await evaluate(`window.santtosAPI.savePlayoutCheckpoint(${JSON.stringify({itemId:backup[0].id,positionSeconds:backup[0].inPoint||0,playing:false})})`);if(badId)await evaluate(`window.santtosAPI.removeMedia(${JSON.stringify(badId)})`)}finally{ws?.close();fs.rmSync(folder,{recursive:true,force:true})}}})().catch(error=>{console.error(error);ws?.close();process.exitCode=1});
