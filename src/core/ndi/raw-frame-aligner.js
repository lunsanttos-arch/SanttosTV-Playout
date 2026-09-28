"use strict";

const { Transform } = require("node:stream");

const PROGRAM_WIDTH = 1920;
const PROGRAM_HEIGHT = 1080;
const BYTES_PER_PIXEL = 4;
const PROGRAM_FRAME_BYTES = PROGRAM_WIDTH * PROGRAM_HEIGHT * BYTES_PER_PIXEL;

/**
 * FFmpeg emits a BYTE stream, not one chunk per image. Its final chunk on
 * STOP/seek can end halfway through a BGRA frame. Piping that directly to a
 * persistent native NDI sender mixes the remainder with the NEXT clip and
 * permanently shifts raster rows (a visible split/tearing effect).
 *
 * Reassemble exactly one full frame before exposing it to the sender.
 * Each FFmpeg playback/seek must get a NEW aligner. On STOP, discard any
 * incomplete tail; do not pad or send it to the persistent NDI process.
 *
 * A Transform and pipe() propagate backpressure from NDI to FFmpeg, so we
 * cannot queue an unbounded number of full-HD frames in Electron.
 */
class RawVideoFrameAligner extends Transform {
    constructor(options = {}) {
        const frameBytes = options.frameBytes ?? PROGRAM_FRAME_BYTES;
        if (!Number.isSafeInteger(frameBytes) || frameBytes < 1 ||
            frameBytes > PROGRAM_FRAME_BYTES) {
            throw new RangeError("Invalid BGRA frame size.");
        }
        super({
            writableHighWaterMark: Math.min(frameBytes, 256 * 1024),
            readableHighWaterMark: frameBytes
        });
        this.frameBytes = frameBytes;
        this.partial = Buffer.allocUnsafe(frameBytes);
        this.filled = 0;
        this.completedFrames = 0;
        this.discardedTailBytes = 0;
    }

    _transform(chunk, _encoding, callback) {
        if (!Buffer.isBuffer(chunk)) {
            callback(new TypeError("Expected binary FFmpeg stdout data."));
            return;
        }
        try {
            let offset = 0;
            while (offset < chunk.length) {
                // Fast path: FFmpeg supplied one or more whole frames at
                // a frame boundary. Buffer views stay alive in downstream
                // stream writes without an additional 8 MB allocation.
                if (this.filled === 0 &&
                    chunk.length - offset >= this.frameBytes) {
                    this.push(chunk.subarray(offset, offset + this.frameBytes));
                    offset += this.frameBytes;
                    this.completedFrames++;
                    continue;
                }
                const n = Math.min(
                    this.frameBytes - this.filled, chunk.length - offset
                );
                chunk.copy(this.partial, this.filled, offset, offset + n);
                this.filled += n;
                offset += n;
                if (this.filled === this.frameBytes) {
                    this.push(this.partial);
                    this.completedFrames++;
                    this.filled = 0;
                    // The previous buffer is now owned by the downstream
                    // sender and MUST NOT be overwritten by the next frame.
                    this.partial = Buffer.allocUnsafe(this.frameBytes);
                }
            }
            callback();
        } catch (error) {
            callback(error);
        }
    }

    _flush(callback) {
        this.discardedTailBytes += this.filled;
        this.filled = 0;
        callback();
    }

    _destroy(error, callback) {
        // STOP/seek destroys this transform. Partial video MUST NOT become
        // the prefix of the next FFmpeg instance's first frame.
        this.discardedTailBytes += this.filled;
        this.filled = 0;
        this.partial = null;
        callback(error);
    }
}

module.exports = {
    PROGRAM_WIDTH,
    PROGRAM_HEIGHT,
    PROGRAM_FRAME_BYTES,
    RawVideoFrameAligner
};
