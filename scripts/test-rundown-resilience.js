"use strict";
const assert = require("node:assert/strict");
const { RundownController } = require("../src/core/playout/rundown-controller");
const { NativePlayoutEngine } = require("../src/core/playout/native-playout-engine");

function fixture({ corrupt = false, filler = null } = {}) {
    const engine = new NativePlayoutEngine({ now: () => 0 });
    const items = ["first", "second"].map(id => ({ id, path: id, duration: 10, outPoint: 10 }));
    const starts = [], reports = [];
    let readyCalls = 0;
    const controller = new RundownController({
        getItems: () => items,
        snapshot: () => engine.snapshot(),
        start: async item => {
            starts.push(item.id);
            // Bound a broken implementation instead of letting a regression hang CI.
            if (starts.length > 4) throw Error("Repeated failed queue");
            if (corrupt) throw Error("Corrupt media");
            engine.start({ itemId: item.id, filePath: item.path, outPointSeconds: 10 });
            return { ok: true };
        },
        stop: mode => { if (mode === "fault") engine.fault("Contingency exhausted"); },
        getContingency: () => filler,
        reportStart: item => { reports.push({ item: item.id }); return { id: reports.length }; },
        reportFinish: (id, status) => { reports[id - 1].status = status; },
        reportReady: () => readyCalls++
    });
    // Stop the test if a corrupt filler starts replaying the failed grade.
    const originalOpen = controller.open.bind(controller);
    controller.open = (...args) => {
        assert(starts.length < 4, "A failed filler must not restart the failed queue");
        return originalOpen(...args);
    };
    return { engine, items, starts, reports, controller, readyCalls: () => readyCalls };
}

(async () => {
    const failed = fixture({ corrupt: true, filler: { id: "filler", path: "filler", duration: 10 } });
    await failed.controller.play(failed.items[0]);
    assert.deepEqual(failed.starts, ["first", "second", "__contingency__"]);
    assert.equal(failed.engine.state, "FAULT");
    assert(failed.reports.every(report => report.status === "PULADO_POR_ERRO"));

    const replay = fixture();
    await replay.controller.play(replay.items[0]);
    const oldOccurrence = replay.engine.snapshot();
    await replay.controller.play(replay.items[0]);
    const generation = replay.engine.generation;
    replay.controller.ready(oldOccurrence);
    assert.equal(replay.readyCalls(), 0, "Old readiness must not mark the new occurrence ready");
    await replay.controller.fault("Delayed failure from old decoder", oldOccurrence);
    assert.equal(replay.engine.generation, generation);
    assert.equal(replay.engine.itemId, "first");
    assert.equal(replay.reports[0].status, undefined);
    replay.controller.ready(replay.engine.snapshot());
    assert.equal(replay.readyCalls(), 1);
    await replay.controller.fault("Current decoder failed", replay.engine.snapshot());
    assert.equal(replay.engine.itemId, "second");
    assert.equal(replay.reports[0].status, "PULADO_POR_ERRO");
    const network = fixture();
    const {DeckPreparer}=require('../src/core/playout/deck-preparer');
    const networkDecks=new DeckPreparer({timeoutMs:30,key:item=>item.id,create:async item=>{
        if(item.id==='first')return new Promise(()=>{}); // A network stat can hang before a decoder exists.
        return {ready:Promise.resolve(),stopped:false,stop(){this.stopped=true;},snapshot(){return {};}};
    }});
    const networkStart=network.controller.startRaw;
    network.controller.startRaw=async item=>{await networkDecks.take(item,0,{});return networkStart(item);};
    await network.controller.play(network.items[0]);
    assert.equal(network.engine.itemId,'second','An unavailable network origin must not prevent automatic advancement');
    assert.equal(network.reports[0].status,'PULADO_POR_ERRO');
    console.log("RUNDOWN RESILIENCE: corrupt filler terminates safely; stale same-item ready/fault events are ignored; current failures still advance");
})().catch(error => { console.error(error); process.exitCode = 1; });
