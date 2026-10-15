"use strict";
const assert = require("node:assert/strict");
const { DecoderDeck } = require("../src/core/playout/decoder-deck");
const { outputProfile } = require("../src/core/playout/output-profile");
const { resolveMediaRuntime } = require("../src/core/media/runtime-paths");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
    const profile = outputProfile({ resolution: "720x480", fps: "25" });
    let previews = 0, frames = 0, audioBytes = 0, cleanups = 0, first = 0, ended;
    const finished = new Promise(resolve => { ended = resolve; });
    const args = ["-hide_banner", "-loglevel", "error", "-filter_complex_threads", "1", "-threads", "1",
        "-f", "lavfi", "-i", "testsrc2=size=720x480:rate=25", "-f", "lavfi", "-i", "sine=sample_rate=48000",
        "-map", "0:v", "-t", "1", "-pix_fmt", profile.ffmpegPixelFormat, "-f", "rawvideo", "pipe:1",
        "-map", "0:v", "-t", "1", "-c:v", "mjpeg", "-threads", "1", "-f", "image2pipe", "pipe:3",
        "-map", "1:a", "-t", "1", "-ac", "2", "-ar", "48000", "-c:a", "pcm_f32le", "-f", "f32le", "pipe:4"];
    const deck = new DecoderDeck({ executable: resolveMediaRuntime("ffmpeg"), args, profile, requireAudio: true,
        graphics: { attach() {}, stop() {} }, source: { cleanup() { cleanups++; } }, duration: 1, remote: false,
        onFrame: () => frames++, onPreview() { previews++; }, onFirst: () => first++, onFinish: ended,
        createAudio: stream => { stream.on("data", chunk => { audioBytes += chunk.length; }); return { stop() {} }; } });
    try {
        await deck.ready; assert(deck.snapshot().bufferedFrames > 0); assert(deck.snapshot().bufferedAudioBytes > 0);
        await delay(100); assert.equal(frames, 0); assert.equal(audioBytes, 0, "PREROLL must not leak audio to PROGRAM");
        await deck.activate(); assert.equal(first, 1);
        const result = await Promise.race([finished, delay(5000).then(() => { throw Error("Deck EOF did not finish"); })]);
        assert.equal(result, null); assert.equal(frames, 25); assert(previews >= 10, "Ahead-of-video JPEG delivery must not starve the monitor"); assert(audioBytes >= 48000 * 2 * 4 * .9); assert.equal(cleanups, 1);
        assert.throws(() => deck.activate(), /pronto/);
        console.log("DECODER DECK: real decoded video/PCM readiness, silent preroll, one CUT, paced playback, EOF and cleanup passed");
    } finally { deck.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
