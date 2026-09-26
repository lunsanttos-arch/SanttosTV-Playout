"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const ffmpeg = require("ffmpeg-static");
const { StereoPcmMeter } = require("../src/core/audio/stereo-meter");
const { audioFfmpegArgs } = require("../src/core/audio/ndi-audio-source");
const { checkNdiRuntime } = require("../src/core/ndi/ndi-capabilities");

let now = 1000;
const meter = new StereoPcmMeter(() => now);
const samples = Buffer.alloc(480 * 8);
for (let n = 0; n < 480; n++) {
    samples.writeFloatLE(0.5 * Math.sin(2 * Math.PI * n / 48), n * 8);
    samples.writeFloatLE(0.25 * Math.sin(2 * Math.PI * n / 48), n * 8 + 4);
}
meter.write(samples.subarray(0, 19));
meter.write(samples.subarray(19, 1707));
meter.write(samples.subarray(1707));
const measured = meter.snapshot();
assert.equal(measured.audioFrames, 480);
assert(measured.leftDb > measured.rightDb + 5,
    "Canais L/R devem ser medidos independentemente.");
assert(measured.leftDb > -12 && measured.leftDb < -8);
assert(measured.peakLeftDb > -7 && measured.peakLeftDb < -5);
now += 2000;
assert.equal(meter.snapshot().active, false);
assert.equal(meter.snapshot().leftDb, -60);
meter.reset();
assert.equal(meter.snapshot().audioFrames, 0);
assert.throws(
    () => audioFfmpegArgs("file.mp4", null, 0, null), /faixa/,
    "Não se deve inventar a faixa de áudio de arquivos sem áudio."
);

const args = audioFfmpegArgs("filme.mp4", 2, 11, 50);
assert.deepEqual(args.slice(args.indexOf("-map"), args.indexOf("-map") + 2),
    ["-map", "0:2"]);
assert(args.includes("48000"));
assert(args.includes("pcm_f32le"));
assert(args.includes("pipe:1"));
assert(args.includes("50.000"));
assert(args.includes("11.000"));

const root = fs.mkdtempSync(path.join(os.tmpdir(), "santtos-ndi-audio-"));
try {
    if (process.platform === "win32") {
        const oldExe = path.join(root, "ndi_legacy.exe");
        fs.writeFileSync(oldExe, "OLD NDI VIDEO BINARY ONLY");
        const absentDll = path.join(root, "absent-runtime.dll");
        const legacy = checkNdiRuntime({
            requireModern: false,
            executablePath: oldExe,
            dllPath: absentDll
        });
        assert.equal(legacy.ok, true,
            "O playout anterior com runtime NDI global não deve parar por falta de DLL local.");
        assert.equal(legacy.modern, false);
        const qa = checkNdiRuntime({
            requireModern: true,
            executablePath: oldExe,
            dllPath: absentDll
        });
        assert.equal(qa.ok, false,
            "Bancada QA jamais pode iniciar um exe legado com o nome de fonte PROGRAM.");
    }
    const input = path.join(root, "tone.wav");
    execFileSync(ffmpeg, [
        "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=0.25",
        "-ac", "2", "-c:a", "pcm_s16le", "-y", input
    ], { windowsHide: true, timeout: 30000 });
    const pcm = execFileSync(ffmpeg,
        audioFfmpegArgs(input, 0, 0, null),
        { windowsHide: true, timeout: 30000, maxBuffer: 1048576 });
    assert.equal(pcm.length % 8, 0, "Audio PCM intercalado deve conter quadros L/R completos.");
    assert(pcm.length >= 10000, "FFmpeg precisa decodificar áudio real.");
    const decoded = new StereoPcmMeter();
    decoded.write(pcm);
    assert(decoded.snapshot().leftDb > -55);
    assert(decoded.snapshot().rightDb > -55);
    const source = fs.readFileSync(
        path.join(__dirname, "../src/core/ndi/ndi_test.cpp"), "utf8");
    assert(source.includes("NDIlib_send_send_audio_v2") &&
        source.includes("audio.channel_stride_in_bytes") &&
        source.includes("NDI AUDIO PIPE READY:"),
        "O sender nativo deve aceitar PCM f32le estéreo e enviá-lo pelo SDK NDI.");
    assert(source.includes('arg == "--capabilities"') &&
        source.indexOf('arg == "--capabilities"') <
        source.indexOf("NDIlib_initialize()"),
        "Verificação de recursos não pode criar uma fonte NDI por acidente.");
    console.log("NDI AUDIO QA: APROVADO — FFmpeg 48kHz stereo, meter L/R, cortes e contrato do sender.");
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
