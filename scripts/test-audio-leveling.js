"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { execFileSync } = require("node:child_process");
const { analyzeLoudness } = require("../src/core/media/loudness-analysis");
const { buildAudioLevelFilter, parseLoudness } = require("../src/core/audio/loudness");
const ffmpeg = require("../src/core/media/runtime-paths").resolveMediaRuntime("ffmpeg");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "santtos-level-"));
const run = args => execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-threads", "1", "-filter_threads", "1", ...args], { maxBuffer: 20 * 1024 * 1024 });
(async () => {
    try {
        const measured = [];
        for (const [name, gain] of [["quiet", .1], ["loud", 2]]) {
            const input = path.join(root, name + ".wav"), output = path.join(root, name + "-out.wav");
            run(["-f", "lavfi", "-i", `sine=frequency=1000:sample_rate=48000:duration=4,volume=${gain}`, "-ac", "2", "-c:a", "pcm_f32le", "-y", input]);
            const loudness = await analyzeLoudness({ ffmpeg, file: input, audioStreamIndex: 0 });
            loudness.mono = await analyzeLoudness({ ffmpeg, file: input, audioStreamIndex: 0, channels: 1 });
            for (const channels of [1, 2]) {
                const filter = buildAudioLevelFilter({ loudness, channels });
                const pcm = run(["-i", input, "-af", filter, "-ac", String(channels), "-ar", "48000", "-f", "f32le", "pipe:1"]);
                assert.equal(pcm.length, 4 * 48000 * channels * 4, "Leveling must preserve sample count and duration");
                if (channels === 1) {
                    run(["-i", input, "-af", filter, "-ac", "1", "-c:a", "pcm_f32le", "-y", output]);
                    const mono = await analyzeLoudness({ ffmpeg, file: output, audioStreamIndex: 0, channels: 1 });
                    assert(Math.abs(mono.integrated + 23) < .5, `${name} mono: ${mono.integrated} LUFS`);
                }
            }
            // Save the processed stereo signal for independent LUFS/true-peak measurement.
            run(["-i", input, "-af", buildAudioLevelFilter({ loudness }), "-c:a", "pcm_f32le", "-y", output]);
            const result = await analyzeLoudness({ ffmpeg, file: output, audioStreamIndex: 0 });
            assert(Math.abs(result.integrated + 23) < .5, `${name}: ${result.integrated} LUFS`);
            assert(result.truePeak <= -1, `Peak ceiling: ${result.truePeak}`);
            measured.push(result.integrated);
        }
        assert(Math.abs(measured[0] - measured[1]) < .5);
        const crest = path.join(root, "crest.wav"), limited = path.join(root, "limited.wav");
        const raw = Buffer.alloc(48000 * 4 * 2 * 4);
        for (let n = 0; n < 48000 * 4; n++) {
            const amplitude = n >= 96000 && n < 98400 ? .95 : .01;
            const sample = amplitude * Math.sin(2 * Math.PI * 1000 * n / 48000);
            raw.writeFloatLE(sample, n * 8); raw.writeFloatLE(sample, n * 8 + 4);
        }
        execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "f32le", "-ar", "48000", "-ac", "2", "-i", "pipe:0", "-c:a", "pcm_f32le", "-y", crest], { input: raw });
        const crestLoudness = await analyzeLoudness({ ffmpeg, file: crest, audioStreamIndex: 0 });
        run(["-i", crest, "-af", buildAudioLevelFilter({ loudness: crestLoudness }), "-c:a", "pcm_f32le", "-y", limited]);
        const limitedLoudness = await analyzeLoudness({ ffmpeg, file: limited, audioStreamIndex: 0 });
        assert(limitedLoudness.truePeak <= -1, `Transient true peak: ${limitedLoudness.truePeak}`);
        assert.equal(buildAudioLevelFilter({ enabled: false }), "aresample=async=1:first_pts=0");
        assert.equal(parseLoudness('{"input_i":"-inf","input_tp":"-inf"}').status, "silent");
        // A/V marker: limiter lookahead must be compensated, without shifting the impulse.
        for (const rate of [44100, 48000]) {
            const pcm = run(["-f", "lavfi", "-i", `aevalsrc=if(eq(n\\,${rate})\\,0.95\\,0):s=${rate}:d=2`,
                "-af", buildAudioLevelFilter({ sampleRate: rate, channels: 1 }), "-ac", "1", "-ar", String(rate), "-f", "f32le", "pipe:1"]);
            assert.equal(pcm.length, rate * 2 * 4);
            let peak = 0, at = 0;
            for (let n = 0; n < pcm.length / 4; n++) { const value = Math.abs(pcm.readFloatLE(n * 4)); assert(Number.isFinite(value)); if (value > peak) { peak = value; at = n; } }
            assert(Math.abs(at - rate) <= 1, `Audio marker shifted by ${at - rate} samples at ${rate}`);
            assert(peak <= .9 && peak > 0);
        }
        console.log("AUDIO LEVELING: 26 dB source difference normalized to -23 LUFS, peak protection, mono/stereo sample count, 44.1/48k impulse alignment, silent and bypass paths passed");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
