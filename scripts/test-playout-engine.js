"use strict";

const assert = require("node:assert/strict");
const { NativePlayoutEngine } = require("../src/core/playout/native-playout-engine");
const { ProgramClock } = require("../src/core/playout/program-clock");
const {
    normalizeStreamIndex,
    videoFilterInput
} = require("../src/core/playout/ffmpeg-stream-map");

let monotonicNs = 1_000_000_000n;
let wallMs = 2_000_000;
const programClock = new ProgramClock({
    monotonicNowNs: () => monotonicNs,
    wallNowMs: () => wallMs
});

assert.equal(programClock.nowMs(), 0);
monotonicNs += 2_500_000_000n;
wallMs -= 60_000;
assert.equal(
    programClock.nowMs(),
    2500,
    "Relógio do PROGRAM não pode voltar quando o relógio civil for ajustado."
);

let nowMs = 1_000_000;
const engine = new NativePlayoutEngine({ now: () => nowMs });

assert.equal(
    normalizeStreamIndex(null),
    null,
    "null não pode virar índice de stream 0."
);
assert.equal(
    normalizeStreamIndex(undefined),
    null,
    "undefined não pode virar índice de stream 0."
);
assert.equal(
    videoFilterInput(null),
    "[0:v:0]",
    "Sem índice explícito o filtro deve selecionar a primeira faixa de vídeo."
);
assert.equal(
    videoFilterInput(2),
    "[0:2]",
    "Índice explícito válido deve continuar sendo respeitado."
);

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

status = engine.start({
    filePath: "https://example.com/live.m3u8",
    itemId: "input-sem-out",
    inPointSeconds: 0,
    startSeconds: 0,
    outPointSeconds: null
});
assert.equal(
    status.outPointSeconds,
    null,
    "Input sem OUT explícito não pode ser truncado para zero."
);
assert.equal(
    status.remainingSeconds,
    null
);

console.log("PLAYOUT ENGINE QA: APROVADO — ProgramClock monotônico, stream mapping, pausa, seek, fim e falha.");
