'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {flushPersistence,closePersistence}=require('../src/core/persistence/json-store');
(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'santtos-schedule-'));try{
 const db=require('../src/database/database');db.initializeDatabase({userDataPath:root});
 const file=path.join(root,'source.mp4');fs.writeFileSync(file,'fixture');const source=db.addMedia([file]).importedItems[0];db.updateMediaMetadata(source.id,{duration:90000,status:'ready'});
 const entry=seconds=>({sourceMediaId:source.id,rundownItemId:'slot',inPoint:0,outPoint:seconds});
 const old=db.saveDailyRundown({date:'2026-10-15',startTime:'00:00',items:[entry(84600)]});
 let day=db.saveDailyRundown({date:'2026-10-16',startTime:'00:00',items:[entry(3600)]});
 assert.equal(new Date(day.startAt).getDate(),15);assert.equal(new Date(day.startAt).getHours(),23);assert.equal(new Date(day.startAt).getMinutes(),30);
 assert.equal(new Date(day.endAt).getDate(),16);assert.equal(new Date(day.endAt).getMinutes(),30);
 const before=day.startAt;
 db.saveDailyRundown({...old,expectedUpdatedAt:old.updatedAt,items:[entry(87300)]});
 day=db.getDailyRundown('2026-10-16');assert.notEqual(day.startAt,before);assert.equal(new Date(day.startAt).getDate(),16);assert.equal(new Date(day.startAt).getMinutes(),15);
 const fields={scheduleDate:day.date,programmedStartAt:day.startAt,effectiveStartAt:day.startAt};
 db.saveTimeline([{...source,id:'file',sourceMediaId:source.id,...fields},{id:'live',placeholder:true,liveSlot:true,duration:60,...fields},{id:'web',sourceType:'input',path:'https://example.test/live.m3u8',duration:60,...fields}]);
 for(const item of db.getTimeline())for(const key of Object.keys(fields))assert.equal(item[key],fields[key]);
 await flushPersistence();db.initializeDatabase({userDataPath:root});assert.equal(db.getDailyRundown(day.date).startAt,day.startAt);
 assert.equal(db.getTimeline()[0].scheduleDate,day.date);
 // A manual start keeps its absolute calendar date, overrides inheritance and survives restart.
 const manualStart = new Date('2026-10-15T23:45:00').toISOString();
 const manual = db.saveDailyRundown({...day,startTime:'23:45',startAtOverride:manualStart});
 assert.equal(manual.startAt,manualStart);assert.equal(manual.previousDate,old.date);assert.equal(manual.inheritedStartAt,day.startAt);
 db.saveDailyRundown({...old,items:[entry(85000)]});
 assert.equal(db.getDailyRundown(day.date).startAt,manualStart,'Predecessor edits must not overwrite the operator start');
 await flushPersistence();await closePersistence();db.initializeDatabase({userDataPath:root});
 assert.equal(db.getDailyRundown(day.date).startAt,manualStart);
 assert.throws(()=>db.saveDailyRundown({...manual,startAtOverride:'invalid'}),/Início programado inválido/);
 const automatic=db.saveDailyRundown({...db.getDailyRundown(day.date),startAtOverride:null});
 assert.equal(automatic.previousDate,old.date);assert.notEqual(automatic.startAt,manualStart);
 // Removing media must block timing instead of shrinking the predecessor to zero.
 db.removeMedia(source.id);const unavailable=db.getDailyRundown('2026-10-16');assert.equal(unavailable.startAt,null);assert.equal(unavailable.endAt,null);
 console.log('SCHEDULE STORE: derived dates, previous-day edit propagation, file/live/web metadata persistence and missing predecessor media fail closed passed');
 }finally{await closePersistence();fs.rmSync(root,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
