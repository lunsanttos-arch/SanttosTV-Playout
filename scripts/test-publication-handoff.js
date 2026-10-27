'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/main/program-runtime.js'),'utf8');
const begin=source.indexOf('    registerTrustedHandle("playout:apply-rundown",');
const end=source.indexOf('    const backupResult =',begin);
async function scenario(mode){
 const old={id:'air',path:'old.mp4'},incoming={id:'next',path:'new.mp4'};
 let queue=[old],state={itemId:old.id,state:'PLAYING'},handler,release,started;
 const entered=new Promise(resolve=>{started=resolve});const gate=new Promise(resolve=>{release=resolve});
 const calls=[];
 const controller={current:old,finished:false,play:async item=>{calls.push(['play',item.id]);state={itemId:item.id,state:'PLAYING'};},stop:()=>calls.push(['stop'])};
 const publisher=async items=>{started();await gate;if(mode==='disk-error')throw Error('ENOSPC');queue=items;};
 new Function('registerTrustedHandle','playoutEngine','getTimeline','rundownController','publishTimeline','mainWindow',source.slice(begin,end))(
  (_channel,listener)=>{handler=listener;},{snapshot:()=>state},()=>queue,controller,publisher,
  {isDestroyed:()=>false,webContents:{send:()=>calls.push(['published'])}});
 const pending=handler({},[incoming]);await entered;
 assert.deepEqual(queue,[old]);assert.deepEqual(calls,[]);
 if(mode==='eof'){state={itemId:old.id,state:'IDLE'};controller.finished=true;}
 if(mode==='manual-stop'){state={itemId:old.id,state:'IDLE'};controller.finished=false;}
 release();
 if(mode==='disk-error'){await assert.rejects(()=>pending,/ENOSPC/);assert.deepEqual(queue,[old]);assert.deepEqual(calls,[]);return;}
 const result=await pending;assert.equal(result.persisted,true);assert.deepEqual(queue,[old,incoming]);
 assert.equal(calls.some(call=>call[0]==='stop'),false);
 assert.equal(calls.some(call=>call[0]==='play'),mode==='eof');
 if(mode==='eof')assert.equal(calls[0][1],incoming.id,'EOF during commit must enter incoming item, never replay the old queue');
}
(async()=>{for(const mode of ['playing','eof','manual-stop','disk-error'])await scenario(mode);
 console.log('PUBLICATION HANDOFF: actual IPC listener keeps air during ACK wait, handles EOF, respects manual stop and rejects disk failure without activation');
})().catch(error=>{console.error(error);process.exitCode=1});
