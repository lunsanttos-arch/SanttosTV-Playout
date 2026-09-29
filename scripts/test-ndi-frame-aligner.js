"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { FixedFrameAssembler } = require("../src/core/ndi/frame-aligner");

function frame(fill, size = 16) {
    return Buffer.alloc(size, fill);
}

const delivered = [];
const assembler = new FixedFrameAssembler(16, buffer => {
    delivered.push(Buffer.from(buffer));
});

// Arbitrary chunking must not matter.
assembler.push(Buffer.concat([
    frame(0x11).subarray(0, 7),
    frame(0x11).subarray(7, 13)
]));
assembler.push(Buffer.concat([
    frame(0x11).subarray(13),
    frame(0x22).subarray(0, 3)
]));
assert.equal(delivered.length, 1);
assert(delivered[0].every(byte => byte === 0x11));
assert.equal(assembler.snapshot().partialBytes, 3);

// Simulate STOP/seek in the middle of a frame. Those bytes must be dropped.
const stopped = assembler.stop();
assert.equal(stopped.droppedBytes, 3);
assert.equal(stopped.frames, 1);
assembler.push(frame(0x99));
assert.equal(delivered.length, 1, "Stopped feed must reject late FFmpeg bytes.");

// A fresh clip starts on a fresh frame boundary. It must never complete
// the 3 bytes left by the previous clip.
const deliveredSecondClip = [];
const next = new FixedFrameAssembler(16, buffer => {
    deliveredSecondClip.push(Buffer.from(buffer));
});
next.push(frame(0x33).subarray(0, 5));
next.push(frame(0x33).subarray(5));
assert.equal(deliveredSecondClip.length, 1);
assert(deliveredSecondClip[0].every(byte => byte === 0x33),
    "No frame may contain bytes from two different clips.");

// Multiple full frames in one chunk should remain individually aligned.
const burst = [];
const many = new FixedFrameAssembler(16, buffer => burst.push(Buffer.from(buffer)));
many.push(Buffer.concat([frame(0x44), frame(0x55), frame(0x66)]));
assert.equal(burst.length, 3);
assert(burst[0].every(byte => byte === 0x44));
assert(burst[1].every(byte => byte === 0x55));
assert(burst[2].every(byte => byte === 0x66));
assert.equal(many.snapshot().partialBytes, 0);

assert.throws(() => new FixedFrameAssembler(0, () => {}), /Tamanho/);
assert.throws(() => new FixedFrameAssembler(16, null), /Callback/);

const main = fs.readFileSync(
    path.join(__dirname, "../src/main/main.js"), "utf8"
);
assert(main.includes("new FixedFrameAssembler(") &&
    main.includes('processRef.stdout.on("data", onVideoBytes)'),
    "Native playout must frame-align FFmpeg stdout before NDI stdin.");
assert(!main.includes("processRef.stdout.pipe(\n        ndiProcess.stdin"),
    "Raw FFmpeg stdout must never be directly piped to the persistent NDI sender.");
assert(main.includes("Frame ${profile.ndiPixelFormat} parcial descartado na troca"),
    "Clip interruption must explicitly drop incomplete raw frames for any configured pixel format.");

console.log(
    "NDI FRAME QA: APROVADO — chunks arbitrários, STOP no meio do frame, troca de clipe e burst preservam limites."
);
