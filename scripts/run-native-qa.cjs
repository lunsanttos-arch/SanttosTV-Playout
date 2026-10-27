"use strict";
// Linux CI: complete Electron/backend integration in disposable DEV NULL profile.
const assert=require("node:assert/strict");
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),folder=fs.mkdtempSync(path.join(os.tmpdir(),'santtos-native-qa-'));
const {resolveMediaRuntime,verifyProgramRuntime}=require('../src/core/media/runtime-paths');
const ffmpeg=resolveMediaRuntime('ffmpeg'),ffprobe=resolveMediaRuntime('ffprobe');
verifyProgramRuntime(ffmpeg);
const logs=path.join(root,'build','native-qa',String(Date.now()));fs.mkdirSync(logs,{recursive:true});const children=[];
let ws,serial=0;const pending=new Map(),wait=ms=>new Promise(r=>setTimeout(r,ms));
function start(executable,args,env,name){const fd=fs.openSync(path.join(logs,name+'.log'),'w');const child=spawn(executable,args,{cwd:root,env:{...process.env,...env},detached:true,stdio:['ignore',fd,fd]});fs.closeSync(fd);children.push(child);child.on('error',e=>console.error(e.message));return child}
async function evaluate(expression){const id=++serial;let timer;const reply=new Promise(r=>pending.set(id,r));ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));try{const data=await Promise.race([reply,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Native QA CDP timeout')),10000)})]);if(data.error||data.result.exceptionDetails)throw Error('Electron API not ready');return data.result.result.value}finally{pending.delete(id);clearTimeout(timer)}}
async function connect(){const pages=await(await fetch('http://127.0.0.1:9333/json',{signal:AbortSignal.timeout(1000)})).json();ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})});ws.addEventListener('message',e=>{const d=JSON.parse(e.data);pending.get(d.id)?.(d);pending.delete(d.id)})}
async function run(script,env={},args=[]){const child=start(process.execPath,[path.join(root,'scripts',script),...args],env,script);const code=await new Promise(r=>child.once('exit',r));if(code!==0)throw Error(`${script} failed (${code}); see build/native-qa/${script}.log`);console.log(script+' passed')}
(async()=>{if(process.platform!=='linux')throw Error('Use Linux with DISPLAY/Xvfb; this is not Windows receiver homologation.');
for(const port of [5173,9333,19334]){let occupied=false;try{await fetch(`http://127.0.0.1:${port}`,{signal:AbortSignal.timeout(700)});occupied=true}catch{}if(occupied)throw Error(`Port ${port} in use; QA does not stop existing applications.`)}
const config=path.join(folder,'config'),cache=path.join(folder,'cache'),documents=path.join(folder,'documents');fs.mkdirSync(config,{recursive:true});fs.mkdirSync(documents,{recursive:true});fs.writeFileSync(path.join(config,'user-dirs.dirs'),`XDG_DOCUMENTS_DIR="${documents}"\n`);
const fixture=path.join(folder,'clip.mp4');execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=25','-f','lavfi','-i','sine=frequency=997:sample_rate=48000','-t','40','-c:v','libx264','-threads','2','-preset','ultrafast','-c:a','aac','-y',fixture]);
start(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--strictPort'],{},'vite');
for(let n=0;n<100;n++){try{if((await fetch('http://127.0.0.1:5173')).ok)break}catch{}await wait(100)}
const electron=path.join(root,'node_modules/electron/dist/electron');
const electronEnv={XDG_CONFIG_HOME:config,XDG_CACHE_HOME:cache,FFMPEG_BIN:ffmpeg,FFPROBE_BIN:ffprobe,SANTTOS_TEST_MODE:'0',SANTTOS_NDI_TEST_MODE:'0'};
let launchCount=0,appChild;function launch(){appChild=start(electron,['.','--no-sandbox','--disable-gpu','--remote-debugging-port=9333','--inspect=127.0.0.1:19334'],electronEnv,'electron-'+(++launchCount));}
async function reboot(){const closed=new Promise(resolve=>appChild.once('exit',resolve));await evaluate('window.close()').catch(()=>{});let timeout;try{await Promise.race([closed,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Graceful shutdown timeout')),10000)})])}finally{clearTimeout(timeout)}ws?.close();ws=null;launch();for(let n=0;n<100;n++){try{if(!ws||ws.readyState!==WebSocket.OPEN)await connect();if(await evaluate('Boolean(window.santtosAPI)'))return}catch{}await wait(150)}throw Error('Restart did not initialize');}
async function stateIs(state,id){for(let n=0;n<150;n++){const status=(await evaluate('window.santtosAPI.getNdiStatus()')).playout;if(status.state===state&&status.itemId===id)return status;await wait(100)}const actual=(await evaluate('window.santtosAPI.getNdiStatus()')).playout;const recovery=await evaluate('window.santtosAPI.getPlayoutRecovery()');throw Error('Expected '+state+' / '+id+'; actual '+actual.state+' / '+actual.itemId+'; checkpoint '+JSON.stringify(recovery));}
launch();
let ready=false;for(let n=0;n<100;n++){try{if(!ws||ws.readyState!==WebSocket.OPEN)await connect();ready=await evaluate('Boolean(window.santtosAPI) && document.readyState === "complete" && location.port === "5173"');if(ready)break}catch{}await wait(200)}if(!ready)throw Error('Electron did not initialize');
await evaluate(`window.santtosAPI.importMedia(${JSON.stringify([fixture])})`);let media;for(let n=0;n<100;n++){media=(await evaluate('window.santtosAPI.getMedia()'))[0];if(media?.duration>=6&&media.quality?.status==='approved')break;await wait(100)}if(!media?.duration||media.quality?.status!=='approved')throw Error('Fixture was not fully analyzed');
// A compact raster keeps CI load separate from hardware production benchmarks.
const settings=await evaluate('window.santtosAPI.getSettings()');await evaluate(`window.santtosAPI.saveOutputSettings(${JSON.stringify({...settings.output,resolution:process.env.SANTTOS_QA_RESOLUTION||'1280x720',fps:process.env.SANTTOS_QA_FPS||'25',ndi:{enabled:true,name:'Santtos QA DEV NULL'},omt:{enabled:false},srt:{enabled:false},rtmp:{enabled:false}})})`);
ws.close();ws=null;
if(process.argv.includes('--quality-recovery-only')){
 await run('test-native-quality-recovery.cjs');await connect();await evaluate('window.santtosAPI.stopNdiFile()');await evaluate('window.close()').catch(()=>{});
 console.log('Bounded H.264 recovery integration passed.');return;
}
if(process.argv.includes('--explorer-drop-only')){
 await run('test-opec-explorer-drop.cjs');await connect();await evaluate('window.santtosAPI.stopNdiFile()');await evaluate('window.close()').catch(()=>{});
 console.log('Explorer file drop integration passed.');return;
}
if(process.argv.includes('--opec-watch-only')){
 await run('test-opec-models.cjs',{SANTTOS_QA_OUTPUT:logs});await connect();await evaluate('window.santtosAPI.stopNdiFile()');await evaluate('window.close()').catch(()=>{});
 console.log('Desktop/remote Opec watching and clip bounds integration passed.');return;
}
if(process.argv.includes('--service-recovery-only')){
 await run('test-native-service-recovery.cjs',{SANTTOS_QA_USERDATA:path.join(config,'santtos-tv-playout')});await connect();await evaluate('window.santtosAPI.stopNdiFile()');await evaluate('window.close()').catch(()=>{});
 console.log('PROGRAM service restart, checkpoint and interrupted report integration passed.');return;
}
if(process.argv.includes('--monitor-only')){
 await run('test-native-monitor-sync.cjs');await connect();await evaluate('window.santtosAPI.stopNdiFile()');await evaluate('window.close()').catch(()=>{});
 console.log('Local monitor stall/recovery synchronization integration passed.');return;
}
if(process.argv.includes('--library-only')){
 await run('test-native-library-watch.cjs');await connect();await evaluate('window.santtosAPI.stopNdiFile()');await evaluate('window.close()').catch(()=>{});
 console.log('Independent Library viewing and common audio leveling integration passed.');return;
}
if(process.argv.includes('--schedule-only')){
 await run('test-native-dated-schedule.cjs');await connect();await evaluate('window.santtosAPI.stopNdiFile()');await evaluate('window.close()').catch(()=>{});
 console.log('Dated schedule integration passed.');return;
}
if(process.argv.includes('--outputs-only')){
 await run('test-native-live-outputs.cjs');await connect();await evaluate('window.santtosAPI.stopNdiFile()');await evaluate('window.close()').catch(()=>{});
 console.log('Live output settings integration passed.');return;
}
if(process.argv.includes('--cadence-only')){
 await run('test-native-cadence.cjs');await connect();await evaluate('window.santtosAPI.stopNdiFile()');await evaluate('window.close()').catch(()=>{});
 console.log('60-second Full HD cadence/preview check passed.');return;
}
await run('test-native-ab-service.cjs');
await run('test-native-monitor-sync.cjs');
await run('test-native-library-watch.cjs');
if(process.argv.includes('--inputs-only')){
 await run('test-input-web-handoff.cjs',{SANTTOS_QA_GRAPHICS:'1'});
 await run('test-input-web-handoff.cjs',{SANTTOS_QA_STALL:'1'});
 await connect();await evaluate('window.santtosAPI.stopNdiFile()');await evaluate('window.close()').catch(()=>{});
 console.log('Focused Full HD input/deck/preview integration passed.');return;
}
await run('test-opec-live-slots.cjs');await run('test-opec-models.cjs',{SANTTOS_QA_OUTPUT:logs});await run('test-opec-auto-advance.cjs');
await run('test-program-autonomy.cjs',{SANTTOS_QA_USERDATA:path.join(config,'santtos-tv-playout')});
await run('test-native-persistence.cjs',{SANTTOS_QA_USERDATA:path.join(config,'santtos-tv-playout')});
await run('test-native-service-recovery.cjs',{SANTTOS_QA_USERDATA:path.join(config,'santtos-tv-playout')});
await run('test-corrupt-contingency.cjs',{SANTTOS_QA_USERDATA:path.join(config,'santtos-tv-playout'),SANTTOS_QA_ELECTRON_PID:String(appChild.pid)});
if(process.argv.includes('--live')){await run('test-input-web-handoff.cjs',{SANTTOS_QA_GRAPHICS:'1'});await run('test-input-web-handoff.cjs',{SANTTOS_QA_STALL:'1'});}
await connect();const item={...media,id:'burn-in-smoke',sourceMediaId:media.id,inPoint:0,outPoint:40,loop:true,freezeEnd:false};await evaluate(`window.santtosAPI.applyNativeRundown(${JSON.stringify([item])})`);await evaluate(`window.santtosAPI.playNdiFile(${JSON.stringify(media.path)},0,'',${JSON.stringify({itemId:item.id,inPointSeconds:0,outPointSeconds:40,loop:true})})`);
ws.close();ws=null;await run('burn-in-program.cjs',{},['--smoke-seconds','5','--output',path.join(logs,'collector-smoke')]);
await connect();const before=(await evaluate('window.santtosAPI.getNdiStatus()')).playout;assert.equal(before.state,'PLAYING');await reboot();const resumed=await stateIs('PLAYING',item.id);assert(resumed.positionSeconds>=before.positionSeconds-0.2,'Restart must resume checkpoint rather than playlist beginning');
await evaluate('window.santtosAPI.pauseNdiFile()');const paused=(await evaluate('window.santtosAPI.getNdiStatus()')).playout;await reboot();const restoredPause=await stateIs('PAUSED',item.id);assert(Math.abs(restoredPause.positionSeconds-paused.positionSeconds)<0.2);console.log('Normal close/reopen resumes occurrence and position; paused occurrence stays paused');
const freezeQueue=[{...item,id:'restart-frz',outPoint:2,loop:false,freezeEnd:true},{...item,id:'restart-last',inPoint:2,outPoint:4,loop:false,freezeEnd:false}];await evaluate(`window.santtosAPI.applyNativeRundown(${JSON.stringify(freezeQueue)})`);await evaluate(`window.santtosAPI.playNdiFile(${JSON.stringify(media.path)},0,'',${JSON.stringify({itemId:'restart-frz',inPointSeconds:0,outPointSeconds:2,freezeEnd:true})})`);await stateIs('ENDED','restart-frz');await reboot();await stateIs('ENDED','restart-frz');console.log('FRZ remains held after restart');
await evaluate('window.santtosAPI.advanceNativeRundown()');await stateIs('IDLE','restart-last');await reboot();await stateIs('ENDED','restart-last');assert((await evaluate('window.santtosAPI.getPlayoutRecovery()')).rundownFinished);console.log('Completed grade stays completed after restart');
ws.close();ws=null;await run('test-native-live-outputs.cjs');await run('test-native-srt-only.cjs');await run('test-native-dated-schedule.cjs');await connect();
await evaluate('window.santtosAPI.stopNdiFile()');await evaluate('window.close()').catch(()=>{});console.log('Electron functional QA passed; collector smoke is not 24/72-hour certification.');
})().catch(error=>{console.error(error.message);process.exitCode=1}).finally(async()=>{ws?.close();await wait(1000);for(const child of children){if(child.exitCode===null&&child.signalCode===null){try{process.kill(-child.pid,'SIGTERM')}catch{}}}fs.rmSync(folder,{recursive:true,force:true})});
