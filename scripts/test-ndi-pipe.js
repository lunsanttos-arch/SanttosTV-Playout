"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const net = require("node:net");
const { execFileSync } = require("node:child_process");
const ffmpeg = require("ffmpeg-static");
const { NdiAudioSource } = require("../src/core/audio/ndi-audio-source");

async function main() {
    if (process.platform !== "win32") {
        console.log("NDI PIPE QA: skipped (Windows named pipes only).");
        return;
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "santtos-audio-pipe-"));
    const pipe = "\\\\.\\pipe\\SanttosAudio-" +
        process.pid.toString(16) + "-" + crypto.randomBytes(5).toString("hex");
    const input = path.join(root, "synthetic-stereo.wav");
    execFileSync(ffmpeg, [
        "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "sine=frequency=500:sample_rate=48000:duration=0.3",
        "-ac", "2", "-c:a", "pcm_s16le", "-y", input
    ], { windowsHide: true, timeout: 30000 });
    let received = 0;
    let frames = 0;
    let nonSilent = false;
    const server = net.createServer(socket => {
        let tail = Buffer.alloc(0);
        socket.on("data", chunk => {
            const bytes = tail.length ? Buffer.concat([tail, chunk]) : chunk;
            const limit = bytes.length - bytes.length % 8;
            for (let i = 0; i < limit; i += 8) {
                const l = bytes.readFloatLE(i);
                const r = bytes.readFloatLE(i + 4);
                assert(Number.isFinite(l) && Number.isFinite(r));
                if (Math.abs(l) > 0.01 && Math.abs(r) > 0.01) nonSilent = true;
                frames++;
            }
            received += limit;
            tail = Buffer.from(bytes.subarray(limit));
        });
    });
    let source;
    try {
        await new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(pipe, resolve);
        });
        source = new NdiAudioSource({
            pipePath: pipe,
            ffmpegPath: ffmpeg,
            filePath: input,
            streamIndex: 0,
            startSeconds: 0,
            durationSeconds: 0.3
        }).start();
        await new Promise((resolve, reject) => {
            const deadline = setTimeout(
                () => reject(new Error("Timeout esperando PCM na pipe Windows")),
                12000
            );
            server.once("connection", socket => {
                socket.once("end", () => {
                    clearTimeout(deadline);
                    resolve();
                });
                socket.once("error", error => {
                    clearTimeout(deadline);
                    reject(error);
                });
            });
        });
        const status = source.snapshot();
        assert(received > 10000 && frames > 1000,
            "Pipe local deve transportar PCM estéreo real.");
        assert(nonSilent, "Os dois canais devem conter sinal.");
        assert(status.bytesSent >= received,
            "O medidor só pode contar bytes produzidos pelo FFmpeg.");
        assert(status.state === "ENDED" || status.state === "FLOWING",
            "Fluxo PCM deve terminar sem erro.");
        console.log("NDI PIPE QA: APROVADO — pipe Windows, FFmpeg PCM e barras L/R.");
    } finally {
        source?.stop();
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(root, { recursive: true, force: true });
    }
}
main().catch(error => {
    console.error("NDI PIPE QA: REPROVADO", error);
    process.exitCode = 1;
});
