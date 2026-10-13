"use strict";
const { performance } = require("node:perf_hooks");

// Live inputs have no natural EOF. Their scheduled OUT belongs to PROGRAM,
// independently of an HTTP read or a trailing PCM pipe finishing in FFmpeg.
class InputDeadline {
    constructor(seconds, onComplete, now = () => performance.now()) {
        this.seconds = seconds; this.onComplete = onComplete; this.now = now;
        this.timer = null; this.deadline = null; this.stopped = false;
    }
    start() {
        if (this.stopped || this.deadline !== null || !Number.isFinite(this.seconds) || this.seconds <= 0) return;
        this.deadline = this.now() + this.seconds * 1000;
        this.tick();
    }
    tick() {
        if (this.stopped) return;
        const remaining = this.deadline - this.now();
        if (remaining <= 0) {
            this.stop(); this.onComplete(); return;
        }
        this.timer = setTimeout(() => this.tick(), Math.max(1, Math.min(remaining, 1000)));
    }
    stop() { this.stopped = true; clearTimeout(this.timer); this.timer = null; }
}
module.exports = { InputDeadline };
