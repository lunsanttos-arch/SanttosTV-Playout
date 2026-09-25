"use strict";

// FFmpeg stdout arrives in arbitrary chunks. Never pass partial BGRA frames
// into the NDI sender: otherwise a cut midway through a frame corrupts the
// first frame of the next program.
async function forwardCompleteFrames(readable, writable, frameSize, onFrame, isCancelled = () => false) {
    if (!Number.isSafeInteger(frameSize) || frameSize <= 0) {
        throw new RangeError("Tamanho de frame inválido.");
    }
    const frame = Buffer.allocUnsafe(frameSize);
    let filled = 0;
    let frames = 0;
    try {
        for await (const raw of readable) {
            if (isCancelled()) return {frames, trailingBytes:filled, cancelled:true};
            const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
            let pos = 0;
            while (pos < chunk.length) {
                if (isCancelled()) return {frames, trailingBytes:filled, cancelled:true};
                const length = Math.min(frameSize - filled, chunk.length - pos);
                chunk.copy(frame, filled, pos, pos + length);
                filled += length;
                pos += length;
                if (filled !== frameSize) continue;
                if (writable.destroyed || !writable.writable) {
                    throw new Error("Sender NDI indisponível durante transferência.");
                }
                await new Promise((resolve, reject) => {
                    writable.write(frame, (error) => error ? reject(error) : resolve());
                });
                frames++;
                onFrame?.(frames);
                filled = 0;
            }
        }
    } catch (error) {
        if (isCancelled()) return {frames, trailingBytes:filled, cancelled:true};
        throw error;
    }
    return {frames, trailingBytes:filled, cancelled:false};
}

module.exports = {forwardCompleteFrames};
