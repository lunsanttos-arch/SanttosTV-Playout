"use strict";
const assert = require("node:assert/strict");
const { FramePacer } = require("../src/core/playout/frame-pacer");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
    const times = [], frames = [];
    let pauses = 0, resumes = 0;
    const source = { pause: () => pauses++, resume: () => resumes++ };
    const profile = { fpsN: 25, fpsD: 1, frameSize: 1920 * 1080 * 2 };
    const pacer = new FramePacer({ profile, source, reserveMs: 160,
        onFrame: frame => { times.push(performance.now()); frames.push(frame[0]); } });
    try {
        for (let batch = 0; batch < 3; batch++) {
            for (let i = 0; i < 8; i++) pacer.push(Buffer.from([batch * 8 + i]));
            await delay(240);
        }
        await pacer.end();
        assert.deepEqual(frames, Array.from({ length: 24 }, (_, i) => i));
        const gaps = times.slice(1).map((time, index) => time - times[index]);
        assert(gaps.every(gap => gap >= 15 && gap < 150), `Unpaced output: ${gaps}`);
        assert(pauses > 0 && resumes > 0, "Decoder backpressure must keep memory bounded");
        const held = new FramePacer({ profile, source, reserveMs: 80, onFrame: () => false });
        held.push(Buffer.alloc(1)); held.push(Buffer.alloc(1));
        await delay(70);
        assert(held.blocked && held.queue.length === 1);
        held.resume(); await delay(70); assert.equal(held.queue.length, 0);
        held.stop(); await held.end();
        const cancelled = new FramePacer({ profile, source, onFrame: () => assert.fail("Stopped frames must not escape") });
        cancelled.push(Buffer.alloc(1)); cancelled.stop(); await cancelled.end();
        console.log("FRAME PACER QA: ordered burst smoothing, bounded buffer, receiver backpressure, EOF and cancellation passed");
    } finally { pacer.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
