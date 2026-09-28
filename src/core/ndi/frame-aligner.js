"use strict";

/**
 * Raw BGRA video has no frame delimiter. This assembler guarantees that
 * the native NDI process receives only complete frames. A partial frame
 * is intentionally dropped when a clip/seek is interrupted so bytes from
 * two different occurrences can never be combined into one NDI picture.
 */
class FixedFrameAssembler {
    constructor(frameSize, onFrame) {
        if (!Number.isSafeInteger(frameSize) || frameSize <= 0) {
            throw new TypeError("Tamanho de frame invalido.");
        }
        if (typeof onFrame !== "function") {
            throw new TypeError("Callback de frame invalido.");
        }
        this.frameSize = frameSize;
        this.onFrame = onFrame;
        this.buffer = Buffer.allocUnsafe(frameSize);
        this.offset = 0;
        this.frames = 0;
        this.stopped = false;
    }

    push(chunk) {
        if (this.stopped || !chunk || chunk.length === 0) return;
        const source = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        let cursor = 0;

        while (cursor < source.length && !this.stopped) {
            const copySize = Math.min(
                this.frameSize - this.offset,
                source.length - cursor
            );
            source.copy(
                this.buffer,
                this.offset,
                cursor,
                cursor + copySize
            );
            this.offset += copySize;
            cursor += copySize;

            if (this.offset === this.frameSize) {
                const complete = this.buffer;
                this.buffer = Buffer.allocUnsafe(this.frameSize);
                this.offset = 0;
                this.frames++;
                this.onFrame(complete);
            }
        }
    }

    stop() {
        if (this.stopped) {
            return { droppedBytes: 0, frames: this.frames };
        }
        this.stopped = true;
        const droppedBytes = this.offset;
        this.offset = 0;
        return { droppedBytes, frames: this.frames };
    }

    snapshot() {
        return {
            frameSize: this.frameSize,
            partialBytes: this.offset,
            frames: this.frames,
            stopped: this.stopped
        };
    }
}

module.exports = { FixedFrameAssembler };
