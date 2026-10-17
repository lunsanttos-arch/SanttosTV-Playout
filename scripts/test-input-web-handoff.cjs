// Isolated DEV NULL QA profile with a video >= 6s, Vite and Electron debug port 9333.
// SANTTOS_QA_STALL=1 holds HLS segment requests to reproduce the old OUT hang.
const sourceUrl = process.env.SANTTOS_QA_HLS_URL || "https://encode.ontvbrasil.com.br/PortoAlegre24hs/video.m3u8";
const injectStall = process.env.SANTTOS_QA_STALL === "1";
const http = require("node:http");
const { execFile } = require("node:child_process");
const assert=require('node:assert/strict');
(async()=>{
const pages=await(await fetch('http://127.0.0.1:9333/json')).json();const ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();ws.addEventListener('message',e=>{const data=JSON.parse(e.data);if(pending.has(data.id)){pending.get(data.id)(data);pending.delete(data.id)}});
const send=(method,params={})=>new Promise(r=>{const key=++id;pending.set(key,r);ws.send(JSON.stringify({id:key,method,params}))});
const evaluate=async expression=>{const result=(await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result;if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description);return result.result.value};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let proxy = null, frozen = false, held = 0;
let inputUrl = sourceUrl;
if (injectStall) {
 const origin = new URL(sourceUrl).origin;
 proxy = http.createServer((request,response)=>{
  if (/\.ts(?:\?|$)/i.test(request.url) && frozen) { held++; return; }
  const remote = new URL(request.url, origin);
  const child = execFile('curl',['-fL','-sS','--max-time','25',remote.href],{encoding:'buffer',maxBuffer:16*1024*1024},(error,data)=>{
   if(response.destroyed)return;
   if(error){response.writeHead(502);response.end();return;}
   response.setHeader('Content-Type',remote.pathname.endsWith('.m3u8')?'application/vnd.apple.mpegurl':'video/mp2t');response.end(data);
  });
  response.on('close',()=>{if(child.exitCode===null)child.kill()});
 });
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 inputUrl = 'http://127.0.0.1:'+proxy.address().port+new URL(sourceUrl).pathname;
}

async function apply(){
 await evaluate(`[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Programação')).click()`);await wait(150);
 await evaluate(`[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Aplicar no Playout')).click()`);
 for(let i=0;i<100;i++){
  const timeline=await evaluate('window.santtosAPI.getTimeline()');
  if(timeline.length===4&&timeline[0].id==='take-web-qa-occurrence'){
   const status=await evaluate(`document.querySelector('.opec-status')?.textContent||''`);
   assert(/Grades alinhadas|Grade encaixada|Programação aplicada/.test(status),status);
   await evaluate(`[...document.querySelectorAll('.sidebar button')].find(b=>/Playout/i.test(b.innerText))?.click()`);
   return;
  }
  await wait(50);
 }
 throw Error('Rundown did not finish applying: '+await evaluate(`document.querySelector('.opec-status')?.textContent||''`));
}
async function monitor(expected){const generations=new Set();let idle=false;for(let i=0;i<350;i++){const s=await evaluate('window.santtosAPI.getNdiStatus()');assert.equal(s.playoutError,null);if(s.playout.state==='PLAYING')generations.add(s.playout.generation);if(s.playout.state==='IDLE'&&generations.size){idle=true;break}await wait(100)}assert.equal(generations.size,expected,'Every scheduled occurrence must play once');assert(idle,'Rundown must finish');return generations.size}
const initialStatus=await evaluate('window.santtosAPI.getNdiStatus()');
if (!initialStatus.devNullSink || initialStatus.testBench) { ws.close(); proxy?.close(); throw Error('Use an isolated DEV NULL profile without native broadcast outputs'); }
const backupInput=await evaluate(`(async()=>{const result=await window.santtosAPI.getWebInputs();return result.inputs.find(input=>input.id==='take-web-qa')||null})()`);
const backupTimeline=await evaluate('window.santtosAPI.getTimeline()');
const date=await evaluate(`(()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')})()`);
const previous=await evaluate(`(()=>{const d=new Date();d.setDate(d.getDate()-1);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')})()`);
const backupPrevious=await evaluate(`window.santtosAPI.getDailyRundown(${JSON.stringify(previous)})`);
const backupRundown=await evaluate(`window.santtosAPI.getDailyRundown(${JSON.stringify(date)})`);
try{
await evaluate(`window.santtosAPI.saveDailyRundown({date:${JSON.stringify(previous)},items:[],startTime:'00:00'})`);
await evaluate(`(async()=>{await window.santtosAPI.stopNdiFile();const source=(await window.santtosAPI.getMedia())[0];const url=${JSON.stringify(inputUrl)};await window.santtosAPI.saveWebInput({id:'take-web-qa',name:'Live HLS take QA',url,protocol:'hls',durationSeconds:20,engine:'ffmpeg'});await window.santtosAPI.saveDailyRundown({date:${JSON.stringify(date)},title:'Web take regression',startTime:[new Date().getHours(),new Date().getMinutes()].map(n=>String(n).padStart(2,'0')).join(':'),items:[0,1,2].map(i=>({sourceMediaId:source.id,rundownItemId:'web-next-'+i,inPoint:i*2,outPoint:i*2+2,freezeEnd:false}))});await window.santtosAPI.saveTimeline([{id:'take-web-qa-occurrence',inputId:'take-web-qa',sourceMediaId:'take-web-qa',sourceType:'input',name:'Live HLS take QA',path:url,extension:'LIVE',duration:20,inPoint:0,outPoint:20,inputProtocol:'hls',inputEngine:'ffmpeg',inputTimingMode:'duration',inputDurationSeconds:20,freezeEnd:false}]);await window.santtosAPI.savePlayoutCheckpoint({itemId:'take-web-qa-occurrence',positionSeconds:0,playing:false});})()`);
await send('Page.reload');await wait(500);
await evaluate(`document.querySelector('button[title="Reproduzir"]').click()`);
let playing=false;for(let i=0;i<150;i++){const state=await evaluate('window.santtosAPI.getNdiStatus()');if(state.playout.state==='PLAYING'&&state.playout.itemId==='take-web-qa-occurrence'){playing=true;break}if(state.playoutError)throw Error(state.playoutError);await wait(100)}assert(playing,'HLS input must be on air before applying OPEC');
if (process.env.SANTTOS_QA_GRAPHICS === "1") {
 const state=await evaluate('window.santtosAPI.getNdiStatus()');
 await evaluate(`(async()=>{for(let i=0;i<80;i++)await window.santtosAPI.updateProgramGraphics({itemId:'take-web-qa-occurrence',watermark:Boolean(i%2),hashtag:'#Live '+i,exhibitionType:i%2?'AO_VIVO':'NORMAL'});})()`);
 const after=await evaluate('window.santtosAPI.getNdiStatus()');assert.equal(after.playout.generation,state.playout.generation,'Live graphics must preserve HLS decoder and scheduled OUT');
}
await apply();
const applied=await evaluate('window.santtosAPI.getTimeline()');assert.equal(applied.length,4);assert.equal(applied[0].id,'take-web-qa-occurrence');
frozen=injectStall;await monitor(4);if(injectStall)assert(held>0,'Must stall an actual HLS segment request');console.log('LIVE INPUT WEB -> OPEC: live HLS preserved on air, then all three scheduled video blocks played automatically');
 }finally{
await evaluate('window.santtosAPI.stopNdiFile()');
await evaluate(`window.santtosAPI.saveDailyRundown(${JSON.stringify(backupPrevious)})`);
await evaluate(`window.santtosAPI.saveDailyRundown(${JSON.stringify(backupRundown)})`);
await evaluate(`window.santtosAPI.saveTimeline(${JSON.stringify(backupTimeline)})`);
await wait(700);
if(backupTimeline.length)await evaluate(`window.santtosAPI.savePlayoutCheckpoint(${JSON.stringify({itemId:backupTimeline[0]?.id,positionSeconds:backupTimeline[0]?.inPoint||0,playing:false})})`);
if(backupInput)await evaluate(`window.santtosAPI.saveWebInput(${JSON.stringify(backupInput)})`);else await evaluate(`window.santtosAPI.removeWebInput('take-web-qa')`);
ws.close();proxy?.close();proxy?.closeAllConnections();
}
})().catch(e=>{console.error(e.message);process.exitCode=1});
