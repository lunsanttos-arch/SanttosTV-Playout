'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const {resolveMediaRuntime}=require('../src/core/media/runtime-paths');
(async()=>{
 const pages=await(await fetch('http://127.0.0.1:9333/json')).json();const ws=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
 await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));let serial=0;const pending=new Map();ws.addEventListener('message',event=>{const reply=JSON.parse(event.data);pending.get(reply.id)?.(reply);pending.delete(reply.id)});
 const evaluate=async expression=>{const id=++serial;const reply=new Promise(resolve=>pending.set(id,resolve));ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));const data=await reply;if(data.result.exceptionDetails)throw Error(data.result.exceptionDetails.exception?.description);return data.result.result.value};
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));const prefix='corrupt-'+Date.now();const folder=fs.mkdtempSync(path.join(os.tmpdir(),'santtos-corrupt-'));
 const imported=[];let suspended=null;
 try{
  const status=await evaluate('window.santtosAPI.getNdiStatus()');assert(status.devNullSink&&!status.testBench);
  await evaluate('window.santtosAPI.stopNdiFile()');const source=(await evaluate('window.santtosAPI.getMedia()'))[0];assert(source?.path);
  const badPath=path.join(folder,'006 CORRUPTO.mp4'),shortPath=path.join(folder,'007 INCOMPLETO.mp4'),packetPath=path.join(folder,'008 QUADRO CORROMPIDO.mp4');fs.copyFileSync(source.path,badPath);fs.copyFileSync(source.path,shortPath);fs.copyFileSync(source.path,packetPath);
  await evaluate(`window.santtosAPI.importMedia(${JSON.stringify([badPath,shortPath,packetPath])})`);let bad,short,packet;
  for(let i=0;i<100;i++){const media=await evaluate('window.santtosAPI.getMedia()');bad=media.find(item=>item.path===badPath);short=media.find(item=>item.path===shortPath);packet=media.find(item=>item.path===packetPath);if(bad?.duration>20&&short?.duration>20&&packet?.duration>20)break;await wait(100)}assert(bad?.duration>20&&short?.duration>20&&packet?.duration>20);imported.push(bad.id,short.id,packet.id);
  fs.writeFileSync(badPath,Buffer.alloc(1024));
  execFileSync(resolveMediaRuntime('ffmpeg'),['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=25','-f','lavfi','-i','sine=frequency=1000:sample_rate=48000','-t','2','-c:v','libx264','-threads','2','-preset','ultrafast','-c:a','aac','-y',shortPath]);
  const packets=JSON.parse(execFileSync(resolveMediaRuntime('ffprobe'),['-v','error','-select_streams','v:0','-show_packets','-show_entries','packet=pos,size,pts_time','-of','json',packetPath],{encoding:'utf8'})).packets;
  const damaged=packets.find(packet=>Number(packet.pts_time)>4);assert(damaged);
  const fd=fs.openSync(packetPath,'r+');try{fs.writeSync(fd,Buffer.alloc(Number(damaged.size)),0,Number(damaged.size),Number(damaged.pos))}finally{fs.closeSync(fd)}
  const items=[{...bad,id:prefix+'-bad',sourceMediaId:bad.id,outPoint:10},{...packet,id:prefix+'-packet',sourceMediaId:packet.id,outPoint:10},{...short,id:prefix+'-short',sourceMediaId:short.id,outPoint:10},{...source,id:prefix+'-stall',sourceMediaId:source.id,outPoint:40},{...source,id:prefix+'-healthy',sourceMediaId:source.id,outPoint:3}].map(item=>({...item,inPoint:0,loop:false,freezeEnd:false}));
  await evaluate(`window.santtosAPI.applyNativeRundown(${JSON.stringify(items)})`);
  await evaluate(`window.santtosAPI.playNdiFile(${JSON.stringify(badPath)},0,'',{itemId:${JSON.stringify(items[0].id)},inPointSeconds:0,outPointSeconds:10})`);
  let started=false;
  for(let i=0;i<180;i++){const state=(await evaluate('window.santtosAPI.getNdiStatus()')).playout;if(state.itemId===items[3].id&&state.state==='PLAYING'){started=true;break}await wait(100)}assert(started,'Header corruption and silent premature EOF must both advance to the next valid occurrence');
  const pid=Number(process.env.SANTTOS_QA_ELECTRON_PID);assert(Number.isInteger(pid)&&pid>0);
  const processes=execFileSync('ps',['-eo','pid,ppid,args'],{encoding:'utf8'}).split('\n').map(line=>line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean);
  const decoder=processes.find(match=>Number(match[2])===pid&&/(?:\/| )ffmpeg(?: |$)/.test(match[3])&&match[3].includes(source.path));assert(decoder,'Only the current disposable decoder may be suspended');suspended=Number(decoder[1]);process.kill(suspended,'SIGSTOP');
  let recovered=false,finished=false;
  for(let i=0;i<240;i++){const state=(await evaluate('window.santtosAPI.getNdiStatus()')).playout;if(state.itemId===items[4].id&&state.state==='PLAYING')recovered=true;if(recovered&&state.state==='IDLE'){finished=true;break}await wait(100)}assert(recovered&&finished,'Frame watchdog must skip the stalled file without an operator action');
  const report=JSON.parse(fs.readFileSync(path.join(process.env.SANTTOS_QA_USERDATA,'reporting','playout-report-state.json'),'utf8')).entries.filter(entry=>entry.occurrenceId?.startsWith(prefix));
  assert.equal(report.filter(entry=>entry.status==='PULADO_POR_ERRO').length,4);assert.equal(report.filter(entry=>entry.status==='EXECUTADO').length,1);
  assert.equal(report[0].contentCode,'006');assert.equal(report[0].contentName,'CORRUPTO');assert(report[1].errorReason);assert(report[2].errorReason.includes('antes do OUT'));assert(report[3].errorReason.includes('Sem novos quadros'));assert(report.filter(entry=>entry.status==='PULADO_POR_ERRO').every(entry=>entry.nextContent));
  console.log('CORRUPT CONTINGENCY: unreadable header, damaged H.264 packet, silent premature EOF and SIGSTOP decoder stall skipped automatically; reasons, codes/names and actual successors persisted');
 }finally{if(suspended)try{process.kill(suspended,'SIGKILL')}catch{}await evaluate('window.santtosAPI.stopNdiFile()').catch(()=>{});for(const id of imported)await evaluate(`window.santtosAPI.removeMedia(${JSON.stringify(id)})`).catch(()=>{});ws.close();fs.rmSync(folder,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1});
