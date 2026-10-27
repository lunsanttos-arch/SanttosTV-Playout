'use strict';
const assert=require('node:assert/strict');
(async()=>{
const pages=await(await fetch('http://127.0.0.1:9333/json')).json(),ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r,{once:true}));let serial=0;const pending=new Map();ws.addEventListener('message',e=>{const d=JSON.parse(e.data);pending.get(d.id)?.(d);pending.delete(d.id)});
const send=(method,params={})=>new Promise(r=>{const id=++serial;pending.set(id,r);ws.send(JSON.stringify({id,method,params}))});
const evaluate=async expression=>{const d=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(d.result.exceptionDetails)throw Error(d.result.exceptionDetails.exception?.description);return d.result.result.value};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try{
assert((await evaluate('window.santtosAPI.getNdiStatus()')).devNullSink,'Disposable DEV NULL only');
const seed=await evaluate(`(async()=>{await window.santtosAPI.stopNdiFile();const source=(await window.santtosAPI.getMedia())[0];const now=new Date();const key=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');const date=key(now);now.setDate(now.getDate()-1);const previous=key(now);const queue=[{...source,id:'dated-air',sourceMediaId:source.id,inPoint:0,outPoint:8},{...source,id:'dated-tail',sourceMediaId:source.id,inPoint:8,outPoint:16}];await window.santtosAPI.applyNativeRundown(queue);await window.santtosAPI.playNdiFile(source.path,0,'',{itemId:queue[0].id,inPointSeconds:0,outPointSeconds:8});return {date,previous,source,queue}})()`);
async function reserve(delta){return evaluate(`(async()=>{const s=(await window.santtosAPI.getNdiStatus()).playout;const end=Date.now()+(16-s.positionSeconds+${delta})*1000;const midnight=new Date(${JSON.stringify(seed.previous)}+'T00:00:00').getTime();const seconds=(end-midnight)/1000;const slots=[];let left=seconds;while(left>0){const duration=Math.min(left,86400);slots.push({rundownItemId:'reserved-'+slots.length,placeholder:true,duration});left-=duration}const old=await window.santtosAPI.getDailyRundown(${JSON.stringify(seed.previous)});await window.santtosAPI.saveDailyRundown({date:${JSON.stringify(seed.previous)},expectedUpdatedAt:old.updatedAt,startTime:'00:00',items:slots});const current=await window.santtosAPI.getDailyRundown(${JSON.stringify(seed.date)});return window.santtosAPI.saveDailyRundown({date:current.date,expectedUpdatedAt:current.updatedAt,startTime:'00:00',items:[{sourceMediaId:${JSON.stringify(seed.source.id)},rundownItemId:'next',inPoint:16,outPoint:20}]})})()`)}
async function apply(saved){return evaluate(`(async()=>{try{return await window.santtosAPI.applyNativeRundown([],${JSON.stringify({date:saved.date,expectedUpdatedAt:saved.updatedAt,expectedStartAt:saved.startAt})})}catch(e){return {error:e.message}}})()`)}
for(const delta of [-240,240]){
 const saved=(await reserve(delta)).rundown;
 const before=await evaluate('window.santtosAPI.getTimeline()');const state=(await evaluate('window.santtosAPI.getNdiStatus()')).playout;
 const rejected=await apply(saved);assert.match(rejected.error,/Aplicação bloqueada/);assert.match(rejected.error,delta>0?/Faltam/:/Sobram/);
 assert.deepEqual((await evaluate('window.santtosAPI.getTimeline()')).map(i=>i.id),before.map(i=>i.id));
 assert.equal((await evaluate('window.santtosAPI.getNdiStatus()')).playout.generation,state.generation);
}
const stale=(await reserve(0)).rundown;await reserve(2);assert.match((await apply(stale)).error,/mudou/);
await reserve(0);
await evaluate(`[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Programação')).click()`);await wait(350);
assert.equal(await evaluate(`document.querySelector('input[aria-label="Início programado"]').readOnly`),false);
assert(await evaluate(`document.querySelector('.opec-entry-time small').textContent.length>0`));
await evaluate(`[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Aplicar no Playout')).click()`);
for(let i=0;i<60;i++){if(await evaluate(`document.querySelector('.opec-status')?.textContent.includes('Grades alinhadas')||document.querySelector('.opec-status')?.textContent.includes('Grade encaixada')`))break;await wait(50)}
const timeline=await evaluate('window.santtosAPI.getTimeline()');assert.equal(timeline.length,3);assert.equal(timeline[0].id,'dated-air');assert.equal(timeline[1].id,'dated-tail');assert.equal(timeline[2].scheduleDate,seed.date);
assert(timeline[2].effectiveStartAt&&timeline[2].programmedStartAt);
const saved=await evaluate(`window.santtosAPI.getDailyRundown(${JSON.stringify(seed.date)})`);assert.match((await apply(saved)).error,/já está/);
await wait(400);assert.equal((await evaluate('window.santtosAPI.getTimeline()')).length,3,'UI autosave must retain appended pending queue');
// The remote controller receives the same inherited absolute bounds.
const controller=await evaluate('window.santtosAPI.setControllerEnabled(true)');const base=`http://127.0.0.1:${controller.port}`;
const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:controller.pin})});const cookie=login.headers.get('set-cookie').split(';')[0];
const web=await(await fetch(base+'/api/rundown?date='+seed.date,{headers:{Cookie:cookie}})).json();assert.equal(web.startAt,saved.startAt);assert.equal(web.previousDate,seed.previous);
await evaluate('window.santtosAPI.setControllerEnabled(false)');
// A real decoder must finish the current clip, keep the tail, then enter the new grade.
const seen=new Set();let ended=false;
for(let i=0;i<260;i++){const s=(await evaluate('window.santtosAPI.getNdiStatus()')).playout;seen.add(s.itemId);if(s.state==='IDLE'){ended=true;break}await wait(100)}
assert(ended);assert(seen.has('dated-tail'));assert(seen.has(timeline[2].id));
// The operator can override an inherited start with seconds, persist it and reload.
await evaluate(`(()=>{const input=document.querySelector('input[aria-label="Início programado"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'23:45:12');input.dispatchEvent(new Event('input',{bubbles:true}))})()`);await wait(100);
await evaluate(`[...document.querySelectorAll('button')].find(b=>b.innerText==='Salvar programação').click()`);await wait(300);
const manual=await evaluate(`window.santtosAPI.getDailyRundown(${JSON.stringify(seed.date)})`);
assert.equal(new Date(manual.startAt).getHours(),23);assert.equal(new Date(manual.startAt).getMinutes(),45);assert.equal(new Date(manual.startAt).getSeconds(),12);assert.equal(manual.startAt,manual.startAtOverride);
await evaluate('setTimeout(()=>location.reload(),0)');await wait(700);
await evaluate(`[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Programação')).click()`);await wait(300);
assert.equal(await evaluate(`document.querySelector('input[aria-label="Início programado"]').value`),'23:45:12');
console.log('MANUAL START: inherited field editable, saved absolute start respected and restored after renderer reload');
console.log('DATED NATIVE: real decoder preserved air+tail, both >3min signs rejected without mutation, stale-bound guard, desktop inherited date/status, authenticated web absolute bounds, metadata survived UI autosave and automatic handoff completed');
}finally{await evaluate('window.santtosAPI.stopNdiFile()').catch(()=>{});ws.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
