const assert=require('node:assert/strict');const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const output=ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../src/renderer/src/rundown-blocks.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const cjs={exports:{}};vm.runInNewContext(output,{module:cjs,exports:cjs.exports,Number,Array,Math,Error,JSON});
const {placeRundownBlocks,rundownDraftReducer}=cjs.exports;
const source={rundownItemId:'film-slot',id:'movie',sourceMediaId:'movie',path:'/movie.mp4',duration:120,inPoint:0,outPoint:120,replacedPlaceholder:true,blockLabel:'Filme',notes:'Primeira parte'};
const ad={rundownItemId:'ad',id:'ad',duration:30,notes:'Comercial'};
const slot=(id,notes)=>({rundownItemId:id,placeholder:true,name:'Conteúdo a definir',duration:120,blockLabel:id,notes});
const initial=[slot('before','Não tocar'),source,ad,slot('next-1','Retorno 1'),{...ad,rundownItemId:'ad-2'},slot('next-2','Retorno 2'),slot('last','Ainda vazio')];
const ranges=[{inPoint:0,outPoint:25},{inPoint:25,outPoint:80},{inPoint:80,outPoint:120}];
const placed=placeRundownBlocks(initial,'film-slot',ranges);assert.equal(placed.length,initial.length);assert.equal(placed[0],initial[0]);assert.equal(placed[2],ad);assert.equal(placed[4],initial[4]);assert.equal(placed[6],initial[6]);
for(const [index,range] of [[1,ranges[0]],[3,ranges[1]],[5,ranges[2]]]){assert.equal(placed[index].inPoint,range.inPoint);assert.equal(placed[index].outPoint,range.outPoint);assert.equal(placed[index].sourceMediaId,'movie');assert.equal(placed[index].rundownItemId,initial[index].rundownItemId);assert.equal(placed[index].notes,initial[index].notes);assert.equal(placed[index].placeholder,false)}
assert.equal(initial[3].placeholder,true);assert.throws(()=>placeRundownBlocks(initial,'ad',ranges),/Somente/);assert.throws(()=>placeRundownBlocks(initial,'before',ranges),/Somente/);assert.throws(()=>placeRundownBlocks(initial.slice(0,4),'film-slot',ranges),/lacuna/);assert.throws(()=>placeRundownBlocks(initial,'film-slot',[{inPoint:1,outPoint:140}]),/válidos/);assert.throws(()=>placeRundownBlocks(initial,'film-slot',[ranges[1],ranges[0]]),/válidos/);
let state=rundownDraftReducer({items:initial,history:[]},{type:'edit',update:placed});state=rundownDraftReducer(state,{type:'undo'});assert.equal(state.items,initial);assert.equal(state.items[3].placeholder,true);assert.equal(state.history.length,0);
const empty={items:[],history:[]};const replacement=[slot('x','')];state=rundownDraftReducer(empty,{type:'edit',update:replacement});state=rundownDraftReducer(state,{type:'edit',update:items=>items.map(item=>({...source,rundownItemId:item.rundownItemId}))});state=rundownDraftReducer(state,{type:'undo'});assert.equal(state.items,replacement);state=rundownDraftReducer(state,{type:'undo'});assert.equal(state.items.length,0);state=rundownDraftReducer(state,{type:'load',items:initial});assert.equal(state.history.length,0);
console.log('RUNDOWN BLOCKS: replacement eligibility, custom cuts into later slots, intervening ads and metadata preserved, insufficient slots rejected atomically, undo restores full draft');

state=rundownDraftReducer({items:initial,history:[]},{type:'edit',update:placed});state=rundownDraftReducer(state,{type:'normalize',items:placed.map(item=>({...item}))});state=rundownDraftReducer(state,{type:'undo'});assert.equal(state.items,initial);

const liveSlot={...slot('reserved-live','Entrada vMix'),liveSlot:true};
const withLive=[source,liveSlot,slot('return','Filme')];
const afterLive=placeRundownBlocks(withLive,'film-slot',ranges.slice(0,2));
assert.equal(afterLive[1],liveSlot);
assert.equal(afterLive[2].sourceMediaId,'movie');
assert.throws(()=>placeRundownBlocks([source,liveSlot],'film-slot',ranges.slice(0,2)),/lacuna/);
