'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
// Execute the actual renderer callback, with only the IPC boundary mocked.
const source=fs.readFileSync(path.join(__dirname,'../src/renderer/src/App.tsx'),'utf8');
const begin=source.indexOf('onApply={async (items, startTime, context) => {')+'onApply={'.length;
const end=source.indexOf('\n                            }}',begin);
const callback=source.slice(begin,end)+'\n}';
const make=reply=>new Function('window','testBench','ndiTestMode','setRundownApplyRequest','return ('+callback+');')({santtosAPI:{applyNativeRundown:async()=>reply}},false,false,()=>assert.fail('Unexpected test branch'));
(async()=>{for(const value of [undefined,null,{}, {ok:true}, {ok:true,persisted:false}, {ok:false,error:'ENOSPC'}, {ok:false,applied:true,persisted:false,error:'Fila em memória; gravação falhou'}])await assert.rejects(()=>make(value)([], '00:00', {}),/ENOSPC|gravação falhou|não confirmou/);
assert.equal(await make({ok:true,persisted:true,message:'Grades alinhadas.'})([],'00:00',{}),'Grades alinhadas.');
console.log('APPLICATION CONFIRMATION: actual callback rejects absent/failed/disk-error replies and preserves confirmed alignment message passed');})().catch(e=>{console.error(e);process.exitCode=1});
