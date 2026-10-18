// Functional regression: isolated Linux DEV NULL profile, Vite and Electron debug port 9333.
const assert=require('node:assert/strict');
(async()=>{
const pages=await(await fetch('http://127.0.0.1:9333/json')).json();const ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();ws.addEventListener('message',e=>{const data=JSON.parse(e.data);if(pending.has(data.id)){pending.get(data.id)(data);pending.delete(data.id)}});
const send=(method,params={})=>new Promise(r=>{const key=++id;pending.set(key,r);ws.send(JSON.stringify({id:key,method,params}))});
const evaluate=async expression=>{const result=(await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result;if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description);return result.result.value};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
// Exercise the undated compatibility path for repeated application/FREEZE regression.
// Dated validation and the actual Apply button are covered by test-native-dated-schedule.
// Pin this fixture date: a run crossing midnight must not read a different empty grade.
async function apply(){await evaluate(`(async()=>{const date=${JSON.stringify(date)};const saved=await window.santtosAPI.getDailyRundown(date);const items=saved.items.map((item,i)=>({...item,id:'legacy-'+Date.now()+'-'+i,loop:false,freezeEnd:false}));return window.santtosAPI.applyNativeRundown(items)})()`);await evaluate(`[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Playout')).click()`);await wait(200)}

async function monitor(expected,initialGeneration){const generations=new Set(initialGeneration?[initialGeneration]:[]);let idle=false;for(let i=0;i<140;i++){const s=await evaluate('window.santtosAPI.getNdiStatus()');assert.equal(s.playoutError,null);if(s.playout.state==='PLAYING')generations.add(s.playout.generation);if(s.playout.state==='IDLE'&&generations.size){idle=true;break}await wait(100)}assert.equal(generations.size,expected,'Every scheduled occurrence must play once');assert(idle,'Rundown must finish');return generations.size}
const initialStatus=await evaluate('window.santtosAPI.getNdiStatus()');
if (!initialStatus.devNullSink || initialStatus.testBench) { ws.close(); throw Error('Use an isolated DEV NULL profile without native broadcast outputs'); }
const backupTimeline=await evaluate('window.santtosAPI.getTimeline()');
const date=await evaluate(`(()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')})()`);
const backupRundown=await evaluate(`window.santtosAPI.getDailyRundown(${JSON.stringify(date)})`);
try{
await evaluate(`(async()=>{await window.santtosAPI.stopNdiFile();const source=(await window.santtosAPI.getMedia())[0];const date=${JSON.stringify(date)};return window.santtosAPI.saveDailyRundown({date,title:'Legacy FREEZE regression',startTime:'00:00',items:[0,1,2].map(i=>({sourceMediaId:source.id,rundownItemId:'legacy-'+i,inPoint:i*2,outPoint:i*2+2,freezeEnd:true}))})})()`);
await send('Page.reload');await wait(500);await apply();const timeline=await evaluate('window.santtosAPI.getTimeline()');assert.equal(timeline.length,3);assert(timeline.every(i=>i.freezeEnd===false));
await evaluate(`document.querySelector('button[title="Reproduzir"]').click()`);await monitor(3);console.log('OPEC applied while stopped: three repeated-source blocks advanced automatically; inherited FREEZE cleared');
await apply();await evaluate(`document.querySelector('button[title="Reproduzir"]').click()`);await wait(200);const onAirGeneration=(await evaluate('window.santtosAPI.getNdiStatus()')).playout.generation;await apply();await monitor(4,onAirGeneration);console.log('OPEC applied on air: current block preserved and four occurrences completed in order');
await apply();
await evaluate(`document.querySelector('button[title="Congelar ao final"]').click()`);await wait(80);
await evaluate(`document.querySelector('button[title="Reproduzir"]').click()`);await wait(3000);
const held=await evaluate('window.santtosAPI.getNdiStatus()');assert.equal(held.playout.state,'ENDED');
const heldTimeline=await evaluate('window.santtosAPI.getTimeline()');assert.equal(held.playout.itemId,heldTimeline[0].id);
console.log('Explicit master FREEZE remains respected after OPEC application');

 }finally{
await evaluate('window.santtosAPI.stopNdiFile()');
await evaluate(`window.santtosAPI.saveDailyRundown(${JSON.stringify(backupRundown)})`);
await evaluate(`window.santtosAPI.saveTimeline(${JSON.stringify(backupTimeline)})`);
await wait(700);
if(backupTimeline.length)await evaluate(`window.santtosAPI.savePlayoutCheckpoint(${JSON.stringify({itemId:backupTimeline[0]?.id,positionSeconds:backupTimeline[0]?.inPoint||0,playing:false})})`);
ws.close();
}
})().catch(e=>{console.error(e.message);process.exitCode=1});
