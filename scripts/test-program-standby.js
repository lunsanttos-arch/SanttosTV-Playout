const assert = require("node:assert/strict");
const { ProgramStandby } = require("../src/core/playout/program-standby");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
    let profile = { width: 16, height: 16, ndiPixelFormat: "bgra", frameSize: 1024, sampleRate: 48000, channels: 2, fpsN: 25, fpsD: 1 };
    let playing = false;
    const frames = [], audio = [];
    const standby = new ProgramStandby({ getProfile: () => profile, isPlaying: () => playing, getFrame: () => null,
        onFrame: frame => frames.push({ profile, frame }), onAudio: pcm => audio.push({ profile, samples: pcm.length / 8, pcm }) });
    try {
        standby.start();
        assert.equal(frames[0].frame.length, 1024);
        assert.equal(frames[0].frame[3], 255);
        playing = true; await wait(120);
        assert.equal(frames.length, 1, "Live decoder suppresses standby video and PCM");
        profile = { ...profile, width: 32, ndiPixelFormat: "i420", frameSize: 768, fpsN: 30000, fpsD: 1001 };
        playing = false; await wait(180);
        const changed = frames.filter(item => item.profile === profile);
        assert(changed.length > 0);
        for (const { frame } of changed) { assert.equal(frame.length, 768); assert.equal(frame[0], 16); assert.equal(frame[512], 128); }
        const silence = audio.filter(item => item.profile === profile);
        assert.equal(silence.reduce((sum, item) => sum + item.samples, 0), Math.floor(silence.length * 48000 * 1001 / 30000));
        assert(silence.every(item => !item.pcm.some(Boolean)));
        console.log("PROGRAM STANDBY: continuous silence, decoder ownership, profile changes and rational PCM cadence passed");
    } finally { standby.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
