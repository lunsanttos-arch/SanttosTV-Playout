"use strict";
// The PROGRAM owns its occurrence, advancement and execution report. The UI is a client.
class RundownController {
    constructor({ getItems, start, stop, snapshot, reportStart, reportFinish, reportSuccessor = null,
        onChange = null, onContingency = null, getContingency = null, reportReady = null, startLive = null }) {
        Object.assign(this,{getItems,startRaw:start,stopRaw:stop,snapshot,reportStart,reportFinish,reportSuccessor,reportReady,onChange,onContingency,getContingency});
        this.startLive = startLive;
        this.flags=new Map();this.current=null;this.report=null;this.epoch=0;this.opening=false;this.generation=null;this.handled=-1;
        this.accumulated=0;this.startPosition=0;this.pendingFailures=[];this.lastIssue=null;this.contingency=false;this.finished=false;
    }
    setFlags(id,patch){this.flags.set(id,{...(this.flags.get(id)||{}),...patch});if(this.current?.id===id)this.current={...this.current,...patch};}
    played() { const s=this.snapshot();return this.accumulated+(s.itemId===this.current?.id&&["PLAYING","ENDED","FAULT"].includes(s.state)?Math.max(0,s.positionSeconds-this.startPosition):0); }
    closeReport(status,details={}) { if(!this.report)return;const id=this.report;this.report=null;
        try{this.reportFinish(id,status,this.played(),details)}catch(error){this.lastIssue="Relatório: "+error.message}
        if(status==="PULADO_POR_ERRO")this.pendingFailures.push(id);
    }
    notify(){this.onChange?.();}
    async play(item,position=Number(item.inPoint)||0,overlay={}) {
        this.finished=false;
        const same=this.current?.id===item.id && this.report;
        if(same)this.accumulated=this.played();else{this.closeReport("PULADO",{reason:"Troca manual"});this.accumulated=0;}
        const token=++this.epoch;this.current={...item};this.startPosition=position;
        return this.open(token,position,overlay);
    }
    async open(token,position,overlay={}) {
        if(token!==this.epoch)return {ok:false,canceled:true};
        if (this.current.placeholder) {
            if (!this.current.liveSlot || !this.startLive) return this.fail("Conteúdo a definir sem material", token);
            this.closeReport("PULADO", { reason: "Entrada ao vivo manual" });
            this.stopRaw("preserve");
            await this.startLive(this.current);
            this.opening=false;this.pendingFault=null;this.contingency=false;this.generation=this.snapshot().generation;
            this.notify();return {ok:true,held:true,playout:this.snapshot(),item:this.current};
        }
        this.opening=true;this.pendingFault=null;this.generation=null;
        if(!this.report){try{this.report=this.reportStart({...this.current,plannedDurationSeconds:Math.max(0,(Number(this.current.outPoint)||Number(this.current.duration)||0)-(Number(this.current.inPoint)||0))}).id}
            catch(error){this.lastIssue="Relatório: "+error.message}}
        try {
            const result=await this.startRaw(this.current,position,overlay);
            if(token!==this.epoch)return {ok:false,canceled:true};
            if(result?.ok===false)throw Error(result.error||"Não foi possível abrir o material.");
            if(this.snapshot().state==="FAULT")throw Error(this.snapshot().error||"Falha no início do material.");
            this.generation=this.snapshot().generation;this.startPosition=this.snapshot().startPositionSeconds??position;this.opening=false;
            if(this.pendingFault)return this.fail(this.pendingFault,token);
            this.contingency=Boolean(this.current.isContingency);this.notify();return {ok:true,playout:this.snapshot(),item:this.current};
        }catch(error){if(token!==this.epoch)return {ok:false,canceled:true};this.opening=false;return this.fail(error.message,token);}
    }
    ready(snapshot) {
        if(snapshot.itemId!==this.current?.id||snapshot.generation!==this.snapshot().generation)return;
        if(this.report)try{this.reportReady?.(this.report)}catch(error){this.lastIssue="Relatório: "+error.message}
        const name=this.current.name||this.current.path;
        for(const id of this.pendingFailures.splice(0))try{this.reportSuccessor?.(id,name)}catch{}
        this.contingency=Boolean(this.current.isContingency);this.notify();
    }
    async ended(snapshot) {
        if(snapshot.itemId!==this.current?.id||snapshot.generation<=this.handled||
            (this.generation!==null&&snapshot.generation!==this.generation))return;
        this.handled=snapshot.generation;this.closeReport("EXECUTADO");
        const item={...(this.getItems().find(item=>item.id===snapshot.itemId)||this.current),...(this.flags.get(snapshot.itemId)||{})};
        if(item.freezeEnd){this.notify();return {ok:true,held:true};}
        return this.advance("completed",this.epoch);
    }
    async fault(message,snapshot=this.snapshot()) {
        if(!this.current||snapshot.itemId!==this.current.id||snapshot.generation!==this.snapshot().generation)return;
        if(this.opening){this.pendingFault=message;return;}
        return this.fail(message,this.epoch);
    }
    async fail(message,token) {
        if(token!==this.epoch)return {ok:false,canceled:true};
        this.lastIssue=String(message||"Falha de conteúdo");this.closeReport("PULADO_POR_ERRO",{reason:this.lastIssue,contingency:"CONTINGÊNCIA"});
        this.contingency=true;this.onContingency?.(this.lastIssue);this.stopRaw("preserve");this.notify();
        return this.advance("error",token);
    }
    async advance(reason="skipped",expected=this.epoch) {
        if(expected!==this.epoch)return {ok:false,canceled:true};
        const items=this.getItems(),index=items.findIndex(item=>item.id===this.current?.id);
        const source={...(items[index]||this.current),...(this.flags.get(this.current?.id)||{})};
        if(reason==="skipped")this.closeReport("PULADO",{reason:"Avanço manual"});
        let next=reason==="completed"&&source?.loop?source:items[index+1];
        // The filler is outside the timeline (index -1). Its failure must not
        // interpret index + 1 as the first clip and retry the entire failed queue.
        if(reason==="error"&&this.current?.isContingency)next=null;
        // Contingency never loops a corrupt clip and does not wrap a failed queue.
        if(!next && reason==="error" && !this.current?.isContingency) {
            const filler=this.getContingency?.();
            if(filler)next={...filler,id:"__contingency__",isContingency:true,loop:true,freezeEnd:false,watermark:false,hashtag:"",blockLabel:"CONTINGÊNCIA",inPoint:0,outPoint:filler.duration};
        }
        if(!next){this.finished=reason==="completed";this.stopRaw(reason==="error"?"fault":"stop");this.notify();return {ok:true,finished:true,contingency:this.contingency,playout:this.snapshot()};}
        this.finished=false;this.current={...next};this.accumulated=0;this.startPosition=Number(next.inPoint)||0;
        const token=++this.epoch;return this.open(token,this.startPosition);
    }
    pause(){this.accumulated=this.played();const token=++this.epoch;this.stopRaw("pause");this.opening=false;this.startPosition=this.snapshot().positionSeconds;this.notify();return {ok:true,playout:this.snapshot(),token};}
    stop(){this.closeReport("PULADO",{reason:"Parada manual"});++this.epoch;this.opening=false;this.contingency=false;this.finished=false;this.stopRaw("stop");this.notify();return {ok:true,playout:this.snapshot()};}
}
module.exports={RundownController};
