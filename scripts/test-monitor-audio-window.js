"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
for (const fps of [25, 30, 60]) {
    const sent = [], module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/main/program-host-adapter.js"), "utf8"), {
        module, require, process: { parentPort: { postMessage: value => sent.push(value) } }, setTimeout, clearTimeout
    });
    const api = module.exports, channel = "playout:audio-pcm";
    const payload = { sampleRate: 48000, channels: 2, data: new Uint8Array(Math.floor(48000 / fps) * 8) };
    // Model a 150 ms renderer ACK round trip: all audio must survive it.
    const count = Math.ceil(fps * .15);
    for (let i = 0; i < count; i++) api.hostEvents(channel, payload);
    assert.equal(sent.length, count, `${fps}fps must survive 150ms ACK latency`);
    for (let i = 0; i < 1000; i++) api.hostEvents(channel, payload);
    assert(sent.length <= Math.floor(fps * .25 + 1e-6), "Transport must stay bounded if renderer hangs");
    const full = sent.length;
    for (let i = 0; i < full; i++) api.receive({ type: "event-ack", channel });
    api.hostEvents(channel, payload); assert.equal(sent.length, full + 1);
    api.receive({ type: "event-reset" });
    api.hostEvents(channel, payload); assert.equal(sent.length, full + 2);
    api.hostEvents("playout:preview-frame", {}); api.hostEvents("playout:preview-frame", {});
    assert.equal(sent.filter(event => event.channel === "playout:preview-frame").length, 1);
}
console.log("MONITOR AUDIO WINDOW: 150ms ACK jitter at 25/30/60fps, bounded hung renderer, recovery/reset and independent preview credit passed");
