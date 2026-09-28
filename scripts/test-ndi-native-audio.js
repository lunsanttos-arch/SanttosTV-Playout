"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, execFileSync } = require("node:child_process");
const ffmpeg = require("ffmpeg-static");
const { NdiAudioSource } = require("../src/core/audio/ndi-audio-source");
const { checkNdiRuntime } = require("../src/core/ndi/ndi-capabilities");

function waitFor(predicate, timeoutMs, label) {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const timer = setInterval(() => {
            if (predicate()) {
                clearInterval(timer);
                resolve();
                return;
            }
            if (Date.now() - started >= timeoutMs) {
                clearInterval(timer);
                reject(new Error("Timeout: " + label));
            }
        }, 50);
    });
}

async function main() {
    if (process.platform !== "win32") {
        console.log("NDI NATIVE AUDIO QA: skipped (Windows x64 only).");
        return;
    }

    const runtime = checkNdiRuntime();
    if (!runtime.ok || !runtime.modern) {
        console.log("NDI NATIVE AUDIO QA: skipped — compile o sender com scripts\\build-ndi.cmd.");
        return;
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "santtos-ndi-native-"));
    const input = path.join(root, "tone.wav");
    const pipePath = "\\\\.\\pipe\\SanttosAudio-" +
        process.pid.toString(16) + "-" + crypto.randomBytes(5).toString("hex");
    const senderPath = path.resolve(__dirname, "../src/core/ndi/ndi_test.exe");

    execFileSync(ffmpeg, [
        "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=0.8",
        "-ac", "2", "-c:a", "pcm_s16le", "-y", input
    ], { windowsHide: true, timeout: 30000 });

    let stdout = "";
    let stderr = "";
    let source = null;
    const sender = spawn(senderPath, [
        "--name", "Santtos TV - QA",
        "--audio-pipe", pipePath
    ], {
        cwd: path.dirname(senderPath),
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
    });

    sender.stdout.on("data", chunk => { stdout += chunk.toString(); });
    sender.stderr.on("data", chunk => { stderr += chunk.toString(); });

    try {
        await waitFor(
            () => stdout.includes("NDI AUDIO PIPE READY:" + pipePath),
            8000,
            "sender nativo não abriu o pipe de áudio"
        );
        await waitFor(
            () => stdout.includes("NDI ONLINE: Santtos TV - QA"),
            8000,
            "sender nativo não ficou online"
        );

        source = new NdiAudioSource({
            pipePath,
            ffmpegPath: ffmpeg,
            filePath: input,
            streamIndex: 0,
            startSeconds: 0,
            durationSeconds: 0.8
        }).start();

        await waitFor(
            () => source.snapshot().bytesSent > 10000,
            10000,
            "FFmpeg não enviou PCM para o pipe nativo"
        );
        await waitFor(
            () => stdout.includes("NDI AUDIO ACTIVE: FLTP 48000Hz 2ch"),
            10000,
            "sender nativo não confirmou envio de áudio ao NDI"
        );

        const snap = source.snapshot();
        assert(snap.bytesSent > 10000);
        assert(snap.leftDb > -55 || snap.peakLeftDb > -55);
        assert(snap.rightDb > -55 || snap.peakRightDb > -55);
        assert.equal(snap.error, null);

        console.log(
            "NDI NATIVE AUDIO QA: APROVADO — FFmpeg -> pipe C++ -> NDI send_audio_v3."
        );
    } finally {
        source?.stop();
        if (!sender.killed) sender.kill();
        fs.rmSync(root, { recursive: true, force: true });
    }

    if (stderr.trim()) {
        console.log("NDI native stderr:", stderr.trim());
    }
}

main().catch(error => {
    console.error("NDI NATIVE AUDIO QA: REPROVADO", error);
    process.exitCode = 1;
});
