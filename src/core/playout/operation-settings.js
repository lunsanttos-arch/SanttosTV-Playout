"use strict";
const fs=require('node:fs'),path=require('node:path');
const {openJsonStore}=require('../persistence/json-store');
const DEFAULTS={resumeOnLaunch:true,startOnLogin:false,watchdogEnabled:true,stallSeconds:8,fillerMediaId:""};
class OperationSettings {
 constructor(folder){this.file=path.join(folder,'operation-settings.json');this.value={...DEFAULTS};if(fs.existsSync(this.file)){try{this.update(JSON.parse(fs.readFileSync(this.file,'utf8')),false)}catch(error){console.error('Configuração de operação inválida; usando padrões:',error.message)}}}
 update(patch,save=true){const next={...this.value};for(const key of ['resumeOnLaunch','startOnLogin','watchdogEnabled'])if(typeof patch?.[key]==='boolean')next[key]=patch[key];
  if(Number.isInteger(patch?.stallSeconds)&&patch.stallSeconds>=5&&patch.stallSeconds<=60)next.stallSeconds=patch.stallSeconds;
  if(typeof patch?.fillerMediaId==='string'&&patch.fillerMediaId.length<=240)next.fillerMediaId=patch.fillerMediaId;
  this.value=next;
  if(save){this.store??=openJsonStore(this.file,()=>this.value);this.store.replace(next);}
  return next;}
}
module.exports={OperationSettings,DEFAULTS};
