"use strict";
const assert = require('node:assert/strict');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
    const pages = await (await fetch('http://127.0.0.1:9333/json')).json();
    const ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
    let serial = 0; const pending = new Map();
    ws.addEventListener('message', event => { const reply = JSON.parse(event.data); pending.get(reply.id)?.(reply); });
    async function evaluate(expression) {
        const id = ++serial; let timer;
        const result = new Promise(resolve => pending.set(id, resolve));
        ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
        try {
            const reply = await Promise.race([result, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Monitor QA timeout')), 15000); })]);
            if (reply.result.exceptionDetails) throw Error(reply.result.exceptionDetails.exception?.description);
            return reply.result.result.value;
        } finally { clearTimeout(timer); pending.delete(id); }
    }
    const call = (method, ...args) => evaluate(`window.santtosAPI.${method}(...${JSON.stringify(args)})`);
    let timeline;
    try {
        assert((await call('getNdiStatus')).devNullSink, 'Use only disposable DEV NULL');
        timeline = await call('getTimeline'); const media = (await call('getMedia'))[0];
        await call('stopNdiFile');
        await evaluate(`(()=>{
            const q=window.__monitorQA={starts:[],stops:0,draws:[],pcm:[],delay:0};
            q.latencyDescriptor=Object.getOwnPropertyDescriptor(AudioContext.prototype,"outputLatency");
            if (${Number(process.env.SANTTOS_QA_MONITOR_LATENCY)||0}>0) Object.defineProperty(AudioContext.prototype,"outputLatency",{configurable:true,get:()=>${Number(process.env.SANTTOS_QA_MONITOR_LATENCY)||0}});
            const signature=(samples,step=1)=>Array.from({length:32},(_,i)=>samples[i*step]?.toPrecision(7)).join(',');
            const start=AudioBufferSourceNode.prototype.start,stop=AudioBufferSourceNode.prototype.stop;
            q.restoreStart=start;q.restoreStop=stop;q.restoreBitmap=window.createImageBitmap;
            AudioBufferSourceNode.prototype.start=function(when=0,offset=0,...rest){
                const ctx=this.context,stamp=ctx.getOutputTimestamp?.();
                const audible=stamp?.contextTime>0&&stamp?.performanceTime>0
                    ? performance.timeOrigin+stamp.performanceTime+(when-stamp.contextTime)*1000
                    : performance.timeOrigin+performance.now()+(when-ctx.currentTime+(ctx.baseLatency||0))*1000;
                q.starts.push({at:performance.timeOrigin+performance.now(),audible,offset,signature:signature(this.buffer.getChannelData(0)),frames:this.buffer.length});
                return start.call(this,when,offset,...rest);
            };
            AudioBufferSourceNode.prototype.stop=function(...args){q.stops++;return stop.apply(this,args)};
            window.createImageBitmap=async(...args)=>{const image=await q.restoreBitmap.apply(window,args);if(q.delay)await new Promise(r=>setTimeout(r,q.delay));return image};
            q.unsubscribe=window.santtosAPI.onProgramAudioPcm(p=>{const bytes=p.data instanceof Uint8Array?p.data:new Uint8Array(p.data);const copy=new Uint8Array(bytes.length);copy.set(bytes);q.pcm.push({time:p.mediaTimeSeconds,generation:p.generation,at:performance.timeOrigin+performance.now(),frames:copy.length/(p.channels*4),signature:signature(new Float32Array(copy.buffer),p.channels)});});
            const canvas=document.querySelector('.program-native-preview-canvas');
            q.observer=new MutationObserver(()=>{if(canvas.dataset.monitorTime)q.draws.push({at:performance.timeOrigin+performance.now(),time:Number(canvas.dataset.monitorTime),epoch:Number(canvas.dataset.monitorEpoch)})});
            q.observer.observe(canvas,{attributes:true,attributeFilter:['data-monitor-time']});
        })()`);
        const item = { ...media, id: 'monitor-sync-local', sourceMediaId: media.id, inPoint: 0, outPoint: 40, loop: true, freezeEnd: false };
        await call('applyNativeRundown', [item]);
        await call('playNdiFile', media.path, 0, '', { itemId: item.id, inPointSeconds: 0, outPointSeconds: 40, loop: true });
        await wait(1800);
        const before = await call('getNdiStatus');
        const baseline = await evaluate('({starts:__monitorQA.starts.length,draws:__monitorQA.draws.length,stops:__monitorQA.stops})');
        if (!(baseline.starts > 8 && baseline.draws > 8)) {
            console.error(await evaluate("({baseline:__monitorQA.starts.length,pcm:__monitorQA.pcm.slice(-2),canvas:document.querySelector('.program-native-preview')?.innerText,now:performance.timeOrigin+performance.now()})"));
            console.error(await evaluate("import('/src/program-monitor-clock.mjs').then(m=>m.programMonitorClock.snapshot())"));
        }
        assert(baseline.starts > 8 && baseline.draws > 8, JSON.stringify(baseline));
        await evaluate('__monitorQA.delay=650'); await wait(850);
        const stalled = await evaluate('({stops:__monitorQA.stops,starts:__monitorQA.starts.length})');
        assert(stalled.stops > baseline.stops, 'Image decoding stall must cancel scheduled local sound');
        await evaluate('__monitorQA.delay=0'); await wait(1200);
        const recoveredAt = await evaluate('performance.timeOrigin+performance.now()');
        // Freeze JavaScript while PROGRAM continues in its separate process.
        await evaluate('(()=>{const until=performance.now()+650;while(performance.now()<until){};})()');
        await wait(1500);
        const after = await call('getNdiStatus');
        assert.equal(after.playout.generation, before.playout.generation);
        assert.equal(after.decks.active.pid, before.decks.active.pid);
        assert(after.playout.positionSeconds > before.playout.positionSeconds + 2);
        const trace = await evaluate('({starts:__monitorQA.starts,draws:__monitorQA.draws,pcm:__monitorQA.pcm})');
        const matched = [];
        for (const start of trace.starts.filter(value => value.at > recoveredAt + 800)) {
            const pcm = trace.pcm.find(value => value.signature === start.signature && value.frames === start.frames && Math.abs(value.at - start.at) < 250);
            const draw = trace.draws.filter(value => value.at <= start.audible).at(-1);
            if (!pcm || !draw || start.audible - draw.at > 100) continue;
            matched.push(pcm.time + start.offset - (draw.time + (start.audible - draw.at) / 1000));
        }
        assert(matched.length >= 5, `Need measured resumed PCM/video pairs: ${matched.length}`);
        const maximum = Math.max(...matched.map(Math.abs)); assert(maximum < .085, `Local scheduling offset after stall: ${maximum}s`);
        console.log(`MONITOR SYNC: actual PCM/WebAudio scheduling and canvas, 650ms bitmap stall + 650ms frozen renderer, scheduled sound canceled, recovery aligned within ${(maximum*1000).toFixed(1)}ms over ${matched.length} matched PCM/video pairs; PROGRAM decoder unchanged`);
    } finally {
        await call('stopNdiFile').catch(() => {});
        if (timeline) await call('saveTimeline', timeline).catch(() => {});
        await evaluate('(()=>{const q=window.__monitorQA;if(!q)return;q.delay=0;q.unsubscribe();q.observer.disconnect();AudioBufferSourceNode.prototype.start=q.restoreStart;AudioBufferSourceNode.prototype.stop=q.restoreStop;window.createImageBitmap=q.restoreBitmap;if(q.latencyDescriptor)Object.defineProperty(AudioContext.prototype,"outputLatency",q.latencyDescriptor);})()').catch(() => {});
        ws.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
