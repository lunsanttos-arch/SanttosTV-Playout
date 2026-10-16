'use strict';
const assert=require('node:assert/strict');
const {scheduleBounds,planRundownApplication:plan,previousDate}=require('../src/core/scheduling/broadcast-schedule.mjs');
const at=(day,time)=>new Date(`2026-10-${day}T${time}`).getTime();
const item=(id,seconds)=>({id,name:id,duration:seconds,inPoint:0,outPoint:seconds});
const first={date:'2026-10-15',items:[item('day',23.5*3600)],updatedAt:'v1',...scheduleBounds('2026-10-15','00:00',[item('day',23.5*3600)])};
let next=scheduleBounds('2026-10-16','00:00',[item('overnight',3600)],first);
assert.equal(Date.parse(next.startAt),at('15','23:30:00'));
assert.equal(Date.parse(next.endAt),at('16','00:30:00'));
const long={...first,items:[item('long',24.25*3600)],...scheduleBounds('2026-10-15','00:00',[item('long',24.25*3600)])};
assert.equal(Date.parse(scheduleBounds('2026-10-16','00:00',[],long).startAt),at('16','00:15:00'));
assert.equal(previousDate('2027-01-01'),'2026-12-31');assert.equal(previousDate('2028-03-01'),'2028-02-29');
const now=at('15','21:00:00'),queue=[item('already',60),item('air',120),item('tail',10680)];
const snapshot={state:'PLAYING',itemId:'air',positionSeconds:0};
const base={items:[item('next',3600)],date:'2026-10-16',queue,snapshot,nowMs:now};
for(const delta of [-180,-179.9,0,179.9,180]){
 const result=plan({...base,startAt:new Date(at('16','00:00:00')+delta*1000).toISOString()});
 assert.equal(result.deltaSeconds,delta);assert.equal(result.timeline.length,4);
 assert.equal(result.timeline[0],queue[0]);assert.equal(result.timeline[1],queue[1]);
 assert.equal(Date.parse(result.timeline[3].effectiveStartAt),at('16','00:00:00'));
 assert.equal(result.timeline[3].duration,3600); // Never alter speed or trim to hide the mismatch.
}
for(const delta of [-181,181,-3600,3600])assert.throws(()=>plan({...base,startAt:new Date(at('16','00:00:00')+delta*1000).toISOString()}),/Aplicação bloqueada.*00:03:00/);
assert.throws(()=>plan({...base,startAt:next.startAt,queue:[{...queue[1],loop:true}]}),/LOOP/);
assert.throws(()=>plan({...base,startAt:next.startAt,queue:[{...queue[1],freezeEnd:true}]}),/FREEZE/);
assert.throws(()=>plan({...base,startAt:next.startAt,snapshot:{...snapshot,state:'PAUSED'}}),/Retome/);
const tomorrow21=plan({...base,queue:[item('air',86400)],snapshot:{state:'PLAYING',itemId:'air',positionSeconds:0},startAt:new Date(at('16','21:00:00')).toISOString()});
assert.equal(Date.parse(tomorrow21.timeline[1].effectiveStartAt),at('16','21:00:00'));
assert.throws(()=>plan({...base,queue:[item('air',86400)],snapshot:{state:'PLAYING',itemId:'air',positionSeconds:0},startAt:new Date(at('15','21:00:00')).toISOString()}),/Sobram 24:00:00/);
const join=plan({items:[item('old',3600),item('cross',7200),item('after',60)],date:'2026-10-16',startAt:new Date(at('15','23:30:00')).toISOString(),nowMs:at('16','02:00:00')});
assert.equal(join.timeline[0].id,'cross');assert.equal(join.timeline[0].inPoint,5400);assert.equal(join.timeline.length,2);
assert.throws(()=>plan({items:[item('expired',60)],date:'2026-10-16',startAt:new Date(at('15','00:00:00')).toISOString(),nowMs:now}),/já terminou/);
assert.throws(()=>plan({...base,startAt:next.startAt,queue:[{...queue[1],scheduleDate:base.date}]}),/já está/);
assert.throws(()=>plan({...base,startAt:null}),/desconhecidos/);
const {rundownPrintHtml}=require('../src/core/scheduling/rundown-pdf');
const html=rundownPrintHtml({date:'2026-10-16',title:'Virada',startTime:'00:00',startAt:next.startAt,items:[item('Filme',3600)]});
assert(html.includes('15/10/2026'));assert(html.includes('23:30:00'));assert(html.includes('16/10/2026'));assert(html.includes('00:30:00'));
console.log('BROADCAST SCHEDULE: previous-day 23:30 / next-day 00:15, year/leap rollover, 180s inclusive both signs, >180s blocked, preserve pending queue, no automatic trims, 02h join across midnight, duplicate/paused/unknown guards, dated HTML/PDF passed');
