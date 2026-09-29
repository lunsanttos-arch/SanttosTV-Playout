"use strict";

const assert = require("node:assert/strict");
const { NativePlayoutEngine } = require("../src/core/playout/native-playout-engine");

let nowMs = 1_000_000;
const engine = new NativePlayoutEngine({ now: () => nowMs });

let status = engine.start({
    filePath: "C:\\media\\program.mp4",
    itemId: "item-01",
    inPointSeconds: 10,
    startSeconds: 10,
    outPointSeconds: 40
});
assert.equal(status.state, "PLAYING");
assert.equal(status.positionSeconds, 10);
assert.equal(status.remainingSeconds, 30);

nowMs += 5000;
status = engine.snapshot();
assert.equal(status.positionSeconds, 15);
assert.equal(status.remainingSeconds, 25);

status = engine.pause();
assert.equal(status.state, "PAUSED");
assert.equal(status.positionSeconds, 15);

nowMs += 9000;
status = engine.snapshot();
assert.equal(status.positionSeconds, 15, "Pausa não pode avançar o relógio do PROGRAM.");

status = engine.seek(25);
assert.equal(status.positionSeconds, 25);
assert.equal(status.state, "PAUSED");

status = engine.start({
    filePath: "C:\\media\\program.mp4",
    itemId: "item-01",
    inPointSeconds: 10,
    startSeconds: 25,
    outPointSeconds: 40
});
nowMs += 3000;
status = engine.snapshot();
assert.equal(status.positionSeconds, 28);
assert.equal(status.remainingSeconds, 12);

status = engine.complete();
assert.equal(status.state, "ENDED");
assert.equal(status.positionSeconds, 40);
assert.equal(status.remainingSeconds, 0);

status = engine.stop();
assert.equal(status.state, "IDLE");
assert.equal(status.positionSeconds, 10, "STOP deve voltar ao IN do bloco.");

engine.start({
    filePath: "C:\\media\\program.mp4",
    itemId: "item-02",
    inPointSeconds: 0,
    startSeconds: 0,
    outPointSeconds: 60
});
nowMs += 2500;
status = engine.fault("decode");
assert.equal(status.state, "FAULT");
assert(status.positionSeconds >= 2.5 && status.positionSeconds < 2.51);
assert.equal(status.error, "decode");

console.log("PLAYOUT ENGINE QA: APROVADO — relógio nativo, pausa, seek, fim e falha.");
