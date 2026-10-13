"use strict";
const assert = require("node:assert/strict");
const { InputDeadline } = require("../src/core/playout/input-deadline");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
    let completions = 0;
    const timer = new InputDeadline(.05, () => completions++);
    await delay(70); assert.equal(completions, 0, "OUT must begin with the first PROGRAM frame");
    timer.start(); timer.start();
    await delay(90); assert.equal(completions, 1, "A blocked live decoder must complete exactly once at OUT");
    timer.tick(); assert.equal(completions, 1);
    const cancelled = new InputDeadline(.05, () => assert.fail("Paused/replaced occurrences must not advance"));
    cancelled.start(); cancelled.stop(); await delay(80);
    const endless = new InputDeadline(null, () => assert.fail("Unbounded sources have no OUT"));
    endless.start(); assert.equal(endless.timer, null); endless.stop();
    console.log("INPUT DEADLINE QA: first-frame anchor, stalled decoder, once-only completion and cancellation passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
