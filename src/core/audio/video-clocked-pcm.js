"use strict";

const { PassThrough } = require("node:stream");

// Release PCM only for video frames already delivered to PROGRAM. FFmpeg can
// write audio ahead of raw video while probing, filtering or filling its pipes.
class VideoClockedPcm {
    constructor(source, profile) {
        this.source = source;
        this.profile = profile;
        this.output = new PassThrough();
        this.frames = 0;
        this.sent = 0;
        this.queue = [];
        this.buffered = 0;
        this.blocked = false;
        this.limit = profile.sampleRate * profile.channels * 4;
        this.onData = (chunk) => {
            this.queue.push(chunk);
            this.buffered += chunk.length;
            if (this.buffered >= this.limit) source.pause();
            this.flush();
        };
        this.onError = (error) => this.output.destroy(error);
        this.onDrain = () => { this.blocked = false; this.flush(); };
        source.on("data", this.onData);
        source.on("error", this.onError);
        this.output.on("drain", this.onDrain);
    }

    advance() { this.frames += 1; this.flush(); }

    flush() {
        const { sampleRate, channels, fpsN, fpsD } = this.profile;
        const sampleBytes = channels * 4;
        const budget = Math.floor(this.frames * sampleRate * fpsD / fpsN) * sampleBytes;
        const count = Math.floor(Math.min(this.buffered, budget - this.sent) / sampleBytes) * sampleBytes;
        if (!this.blocked && count > 0) {
            const packet = Buffer.allocUnsafe(count);
            let offset = 0;
            while (offset < count) {
                const chunk = this.queue[0];
                const size = Math.min(chunk.length, count - offset);
                chunk.copy(packet, offset, 0, size);
                if (size === chunk.length) this.queue.shift();
                else this.queue[0] = chunk.subarray(size);
                offset += size;
            }
            this.sent += count;
            this.buffered -= count;
            this.blocked = !this.output.write(packet);
        }
        // A short video reserve may not contain enough frames to drain half
        // the PCM budget. Resume as soon as any capacity is available, or the
        // shared FFmpeg can block on audio before producing the next video.
        if (!this.blocked && this.buffered < this.limit) this.source.resume();
    }

    stop() {
        this.source.off("data", this.onData);
        this.source.off("error", this.onError);
        this.output.off("drain", this.onDrain);
        this.queue = [];
        this.buffered = 0;
        this.source.resume();
        this.output.destroy();
    }
}

module.exports = { VideoClockedPcm };
