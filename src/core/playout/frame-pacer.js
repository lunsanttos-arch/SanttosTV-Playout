"use strict";
const { performance } = require("node:perf_hooks");

// A bounded jitter buffer for live decoders. Never duplicate/drop PROGRAM frames
// to catch up: audio is released by the same delivered-frame clock.
class FramePacer {
    constructor({ profile, source, onFrame, reserveMs = 600 }) {
        this.source = source; this.onFrame = onFrame;
        this.period = 1000 * profile.fpsD / profile.fpsN;
        const memoryFrames = Math.max(2, Math.floor(128 * 1024 * 1024 / profile.frameSize));
        this.reserve = Math.max(2, Math.min(memoryFrames - 1, Math.ceil(reserveMs / this.period)));
        this.limit = Math.max(this.reserve + 1, Math.min(memoryFrames, this.reserve * 2));
        this.queue = []; this.timer = null; this.next = 0;
        this.blocked = false; this.stopped = false; this.ended = false;
        this.finished = new Promise(resolve => { this.resolveFinished = resolve; });
    }
    push(frame) {
        if (this.stopped) return;
        this.queue.push(frame);
        if (this.queue.length >= this.limit) this.source.pause();
        if (!this.next && this.queue.length >= this.reserve) this.next = performance.now();
        this.schedule();
    }
    schedule() {
        if (this.stopped || this.blocked || this.timer || !this.next) return;
        if (!this.queue.length) { if (this.ended) this.resolveFinished(); return; }
        this.timer = setTimeout(() => {
            this.timer = null;
            if (this.stopped || this.blocked) return;
            const frame = this.queue.shift();
            this.blocked = this.onFrame(frame) === false;
            this.next = Math.max(this.next + this.period, performance.now() + this.period / 2);
            if (!this.blocked && this.queue.length < this.reserve) this.source.resume();
            this.schedule();
        }, Math.max(0, this.next - performance.now()));
    }
    resume() {
        if (this.stopped) return;
        this.blocked = false;
        if (this.queue.length < this.reserve) this.source.resume();
        this.schedule();
    }
    end() {
        this.ended = true;
        if (!this.queue.length) this.resolveFinished();
        else { if (!this.next) this.next = performance.now(); this.schedule(); }
        return this.finished;
    }
    stop() {
        this.stopped = true; clearTimeout(this.timer); this.timer = null;
        this.queue = []; this.resolveFinished();
    }
}
module.exports = { FramePacer };
