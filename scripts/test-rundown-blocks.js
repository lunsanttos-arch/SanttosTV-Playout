const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const output = ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../src/renderer/src/rundown-blocks.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const moduleRef={exports:{}};vm.runInNewContext(output,{module:moduleRef,exports:moduleRef.exports,Number,Array,Math,Error});
let id=0;const split=item=>moduleRef.exports.splitRundownItem(item,3,()=>String(++id));
const slot={rundownItemId:'slot',placeholder:true,duration:5400,inPoint:0,outPoint:5400,scheduledTime:'20:00',notes:'Reservado',blockLabel:'Filme'};
assert.throws(()=>split(slot), /Defina o vídeo/);
const video={...slot,placeholder:false,sourceMediaId:'movie',duration:100,inPoint:10,outPoint:80,loop:true,freezeEnd:true};const cuts=split(video);assert.equal(cuts[0].inPoint,10);assert.equal(cuts[2].outPoint,80);assert(cuts.every(b=>b.sourceMediaId==='movie'&&!b.loop&&!b.freezeEnd&&b.notes==='Reservado'));assert.equal(new Set(cuts.map(b=>b.rundownItemId)).size,3);assert.equal(video.inPoint,10);assert.equal(cuts[0].outPoint,cuts[1].inPoint);assert.equal(cuts[1].outPoint,cuts[2].inPoint);assert(Math.abs(cuts.reduce((sum,b)=>sum+b.outPoint-b.inPoint,0)-70)<1e-9);
for(const count of [0,1,2.5,101,NaN])assert.throws(()=>moduleRef.exports.splitRundownItem(video,count,()=>''));assert.throws(()=>moduleRef.exports.splitRundownItem({...video,inPoint:0,outPoint:1,duration:1},2,()=>''));console.log('RUNDOWN BLOCKS: defined videos preserve duration, metadata and contiguous cuts; undefined slots and invalid divisions rejected');
