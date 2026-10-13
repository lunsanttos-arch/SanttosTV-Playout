// Functional QA: isolated DEV NULL Electron profile and Vite, debug port 9333.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
(async()=>{
const pages=await(await fetch('http://127.0.0.1:9333/json')).json();const ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();ws.addEventListener('message',e=>{const x=JSON.parse(e.data);if(pending.has(x.id)){pending.get(x.id)(x);pending.delete(x.id)}});
const send=(method,params={})=>new Promise(r=>{const key=++id;pending.set(key,r);ws.send(JSON.stringify({id:key,method,params}))});
const evaluate=async expression=>{const result=(await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result;if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description);return result.result.value};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const initial=await evaluate('window.santtosAPI.getNdiStatus()');assert(initial.devNullSink&&!initial.testBench,'Use an isolated DEV NULL profile');
const backup=await evaluate('window.santtosAPI.getTimeline()'),settings=await evaluate('window.santtosAPI.getSettings()');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'santtos-native-gc-'));const logo=path.join(folder,'logo.png');
execFileSync(process.env.FFMPEG_BIN||require('ffmpeg-static'),['-v','error','-f','lavfi','-i','color=white:s=32x32','-frames:v','1','-threads','1','-y',logo]);
try{
await evaluate(`(async()=>{await window.santtosAPI.stopNdiFile();const url='https://encode.ontvbrasil.com.br/PortoAlegre24hs/video.m3u8';await window.santtosAPI.saveWebInput({id:'graphics-live-qa',name:'Graphics live QA',url,protocol:'hls',durationSeconds:60,engine:'ffmpeg'});await window.santtosAPI.saveTimeline([{id:'graphics-functional-qa',inputId:'graphics-live-qa',sourceMediaId:'graphics-live-qa',sourceType:'input',path:url,name:'Graphics live QA',inputProtocol:'hls',inputTimingMode:'duration',inputEngine:'ffmpeg',duration:60,inPoint:0,outPoint:60,watermark:false,hashtag:'',loop:false,freezeEnd:false}]);await window.santtosAPI.savePlayoutCheckpoint({itemId:'graphics-functional-qa',positionSeconds:0,playing:false});})()`);
await send('Page.reload');await wait(700);
await evaluate(`document.querySelector('button[title="Reproduzir"]').click()`);
let start;for(let i=0;i<100;i++){start=await evaluate('window.santtosAPI.getNdiStatus()');if(start.playout.state==='PLAYING')break;await wait(100)}assert.equal(start.playout.state,'PLAYING');const generation=start.playout.generation;
// The real renderer checkbox must update the graph without restarting PROGRAM.
for(let i=0;i<20;i++){await evaluate(`document.querySelector('.timeline-watermark-toggle input').click()`);await wait(20)}
const burst=await evaluate(`(async()=>{const api=window.santtosAPI;const results=[];for(let i=0;i<500;i++)results.push(api.updateProgramGraphics({itemId:'graphics-functional-qa',watermark:Boolean(i%2),hashtag:"#O'Brien : ç 😀 "+i,exhibitionType:i%2?'AO_VIVO':'NORMAL'}));return (await Promise.all(results)).every(r=>r.ok&&r.generation===${generation})})()`);assert(burst);
await evaluate(`window.santtosAPI.updateProgramGraphics({itemId:'graphics-functional-qa',watermark:true,hashtag:'#Final',exhibitionType:'ESTREIA',refreshStyle:true})`);
await evaluate(`window.santtosAPI.saveWatermarkStyle({...${JSON.stringify(settings.watermarkStyle)},filePath:${JSON.stringify(logo)},widthPx:240,x:1300,y:120,opacity:0.7})`);
let final;for(let i=0;i<120;i++){await wait(100);final=await evaluate('window.santtosAPI.getNdiStatus()');if(final.graphics?.pending===0&&i>25)break;}assert.equal(final.playout.generation,generation,'Graphics must never restart decoder');assert.equal(final.playout.state,'PLAYING');assert.equal(final.playoutError,null);assert.equal(final.graphics.errors,0);assert.equal(final.graphics.pending,0);assert(final.playout.positionSeconds>start.playout.positionSeconds+2);
assert.equal((await evaluate(`window.santtosAPI.updateProgramGraphics({itemId:'old-item',hashtag:'stale'})`)).stale,true);
await evaluate('window.santtosAPI.pauseNdiFile()');assert.equal((await evaluate('window.santtosAPI.getNdiStatus()')).playout.state,'PAUSED');
await evaluate(`(async()=>{const item=(await window.santtosAPI.getTimeline())[0];return window.santtosAPI.playNdiFile(item.path,0,'#Resume',{itemId:item.id,outPointSeconds:60,sourceType:'input',inputProtocol:'hls',watermarkEnabled:true})})()`);let resumed;for(let i=0;i<100;i++){await wait(100);resumed=await evaluate('window.santtosAPI.getNdiStatus()');if(resumed.playout.state==='PLAYING')break;}assert.equal(resumed.playout.state,'PLAYING');
console.log('NATIVE LIVE GRAPHICS: 20 real logo clicks + 500 simultaneous logo/text/identification updates + hot style/image replacement + stale edits + PAUSE/PLAY passed; decoder generation unchanged during graphics; '+JSON.stringify(final.graphics));
}finally{await evaluate('window.santtosAPI.stopNdiFile()');await evaluate(`window.santtosAPI.saveWatermarkStyle(${JSON.stringify(settings.watermarkStyle)})`);await evaluate(`window.santtosAPI.saveTimeline(${JSON.stringify(backup)})`);await wait(700);if(backup.length)await evaluate(`window.santtosAPI.savePlayoutCheckpoint(${JSON.stringify({itemId:backup[0].id,positionSeconds:backup[0].inPoint||0,playing:false})})`);await evaluate("window.santtosAPI.removeWebInput('graphics-live-qa')");ws.close();fs.rmSync(folder,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
