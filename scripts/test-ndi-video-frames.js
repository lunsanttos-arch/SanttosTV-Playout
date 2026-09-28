"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Readable, Writable } = require("node:stream");
const { once } = require("node:events");
const {
    RawVideoFrameAligner, PROGRAM_FRAME_BYTES
} = require("../src/core/ndi/raw-frame-aligner");

function collectSender() {
    const frames = [];
    const sender = new Writable({
        highWaterMark: 1, // Force backpressure on every whole-frame write.
        write(buffer, _encoding, done) {
            assert.equal(buffer.length, PROGRAM_FRAME_BYTES,
                "NDI sender must never receive a fractional BGRA frame.");
            // Copy as the native process receives a byte stream, not a
            // JS reference whose contents can be reused for another frame.
            frames.push(Buffer.from(buffer));
            setImmediate(done);
        }
    });
    return { sender, frames };
}

async function testClip(sender, chunks) {
    const producer = Readable.from(chunks);
    const aligner = new RawVideoFrameAligner();
    producer.pipe(aligner).pipe(sender, { end: false });
    await once(aligner, "end");
    // The sender is persistent across all FFmpeg clips.
    return aligner;
}

async function main() {
    // A deliberately easy-to-detect left/right split of two DIFFERENT
    // scenes: truncating clip A mid-frame used to join the remainder to
    // clip B and permanently shift all following raster bytes.
    const a = Buffer.alloc(PROGRAM_FRAME_BYTES, 0x21);
    const b = Buffer.alloc(PROGRAM_FRAME_BYTES, 0x72);
    const c = Buffer.alloc(PROGRAM_FRAME_BYTES, 0xcc);
    const { sender, frames } = collectSender();

    const half = Math.floor(PROGRAM_FRAME_BYTES / 2);
    const finishedA = await testClip(sender, [
        a.subarray(0, 3),               // Start split inside a pixel
        a.subarray(3, 65539),
        a.subarray(65539, half),
        a.subarray(half),
        b.subarray(0, half)             // STOP midframe, not a whole picture
    ]);
    assert.equal(finishedA.completedFrames, 1);
    assert.equal(finishedA.discardedTailBytes, half,
        "Interrupted clip tail must be discarded, not sent to NDI.");

    const finishedB = await testClip(sender, [
        b.subarray(0, 1),               // New clip starts at byte zero
        b.subarray(1, half - 17),
        b.subarray(half - 17),
        c.subarray(0, 31),
        c.subarray(31)
    ]);
    assert.equal(finishedB.completedFrames, 2);
    assert.equal(finishedB.discardedTailBytes, 0);

    // The sender is a slow Writable and an old clip may be queued in its
    // stream; wait for the three complete frame writes to finish.
    await new Promise((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error("Sender timed out")), 15000);
        const check = () => {
            if (frames.length === 3 && sender.writableLength === 0) {
                clearTimeout(deadline);
                resolve();
            } else setImmediate(check);
        };
        check();
    });
    assert(frames[0].equals(a), "First clip's frame became torn.");
    assert(frames[1].equals(b), "Next clip's first frame contains bytes of old clip.");
    assert(frames[2].equals(c), "Misalignment persisted into later frames.");

    // Seek while FFmpeg is between pixels/rows. Destroy the current
    // aligner, and a fresh one must NOT inherit even one old byte.
    const oldSeek = new RawVideoFrameAligner();
    oldSeek.write(a.subarray(0, half + 7));
    oldSeek.destroy();
    assert.equal(oldSeek.discardedTailBytes, half + 7);
    const seeked = await testClip(sender, [
        c.subarray(0, 222221),
        c.subarray(222221)
    ]);
    assert.equal(seeked.completedFrames, 1);
    await new Promise(resolve => setImmediate(resolve));
    assert(frames[3].equals(c), "Seek joined old fractional raster to new video.");

    // Off-air normal early EOF may contain no complete frame.
    const empty = await testClip(sender, [a.subarray(0, 4000)]);
    assert.equal(empty.completedFrames, 0);
    assert.equal(empty.discardedTailBytes, 4000);
    assert.equal(frames.length, 4);

    // A complete frame followed by a tail must emit exactly ONE frame.
    assert.throws(() => new RawVideoFrameAligner({ frameBytes: 0 }), /Invalid/);
    const mainFile = fs.readFileSync(
        path.join(__dirname, "../src/main/main.js"), "utf8"
    );
    assert(mainFile.includes("processRef.stdout.pipe(videoFrames).pipe(") &&
           mainFile.includes("detachNdiVideoFeed(processToStop, alignerToStop)"),
           "Playback must frame-align video and discard partial frames on STOP.");
    assert(!mainFile.includes("processRef.stdout.pipe(\n        ndiProcess.stdin"),
           "Direct arbitrary-chunk FFmpeg piping reintroduces NDI raster tearing.");

    sender.end();
    await once(sender, "finish");
    console.log("NDI VIDEO QA: APROVADO — quadros BGRA inteiros, troca, seek, EOF e backpressure.");
}

main().catch(error => {
    console.error("NDI VIDEO QA: REPROVADO", error);
    process.exitCode = 1;
});
