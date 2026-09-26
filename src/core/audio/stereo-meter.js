"use strict";

/**
 * Meter for signed 32-bit little-endian stereo PCM at 48 kHz.
 * Data arrives from the very same FFmpeg pipe sent to the NDI audio
 * socket, so this is a SOURCE meter (not a receiver-side measurement).
 * Supports arbitrary stdout chunk boundaries without inventing samples.
 */
class StereoPcmMeter {
    constructor(now = Date.now) {
        this.now = now;
        this.tail = Buffer.alloc(0);
        this.left = -60;
        this.right = -60;
        this.peakLeft = -60;
        this.peakRight = -60;
        this.lastAt = null;
        this.frames = 0;
    }

    reset() {
        this.tail = Buffer.alloc(0);
        this.left = this.right = this.peakLeft = this.peakRight = -60;
        this.lastAt = null;
        this.frames = 0;
    }

    write(chunk) {
        if (!Buffer.isBuffer(chunk) || chunk.length === 0) return this.snapshot();
        const buffer = this.tail.length ? Buffer.concat([this.tail, chunk]) : chunk;
        const complete = buffer.length - (buffer.length % 8);
        this.tail = complete < buffer.length
            ? Buffer.from(buffer.subarray(complete)) : Buffer.alloc(0);
        if (!complete) return this.snapshot();

        let energyL = 0, energyR = 0;
        let peakL = 0, peakR = 0;
        const count = complete / 8;
        for (let i = 0; i < complete; i += 8) {
            const left = buffer.readFloatLE(i);
            const right = buffer.readFloatLE(i + 4);
            const l = Number.isFinite(left) ? Math.min(2, Math.abs(left)) : 0;
            const r = Number.isFinite(right) ? Math.min(2, Math.abs(right)) : 0;
            energyL += l * l;
            energyR += r * r;
            if (l > peakL) peakL = l;
            if (r > peakR) peakR = r;
        }
        const toDb = value => Math.max(-60, Math.min(6, 20 * Math.log10(Math.max(0.001, value))));
        this.left = toDb(Math.sqrt(energyL / count));
        this.right = toDb(Math.sqrt(energyR / count));
        this.peakLeft = Math.max(this.peakLeft - 2, toDb(peakL));
        this.peakRight = Math.max(this.peakRight - 2, toDb(peakR));
        this.frames += count;
        this.lastAt = this.now();
        return this.snapshot();
    }

    snapshot() {
        const fresh = this.lastAt !== null && this.now() - this.lastAt < 1500;
        return {
            leftDb: fresh ? this.left : -60,
            rightDb: fresh ? this.right : -60,
            peakLeftDb: fresh ? this.peakLeft : -60,
            peakRightDb: fresh ? this.peakRight : -60,
            audioFrames: this.frames,
            active: fresh
        };
    }
}

module.exports = { StereoPcmMeter };
