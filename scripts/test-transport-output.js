"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn, execFileSync } = require("node:child_process");
const { TransportOutput, transportUrl } = require("../src/core/playout/transport-output");
const ffmpeg = process.env.FFMPEG_BIN || require("ffmpeg-static");
const ffprobe = process.env.FFPROBE_BIN || require("@derhuerst/ffprobe-static").path;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
    const server = net.createServer();
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port;
}
async function test(kind, folder) {
    const port = await freePort();
    const destination = kind === "srt" ? `srt://127.0.0.1:${port}?mode=listener` : `rtmp://127.0.0.1:${port}/live/test`;
    const file = path.join(folder, kind + ".ts");
    const receiver = spawn(ffmpeg, ["-hide_banner", "-loglevel", "info", ...(kind === "rtmp" ? ["-listen", "1"] : []),
        "-analyzeduration", "500000", "-probesize", "32768", "-i", destination, "-map", "0:v", "-map", "0:a", "-c", "copy", "-y", file], { stdio: ["ignore", "ignore", "pipe"] });
    let errors = "";
    receiver.stderr.on("data", data => errors += data.toString());
    receiver.on("error", error => errors += error.message);
    const closed = new Promise(resolve => receiver.once("close", resolve));
    const profile = { width: 320, height: 180, ffmpegPixelFormat: "bgra", fpsN: 25, fpsD: 1,
        fpsExpression: "25/1", sampleRate: 48000, channels: 2 };
    const output = new TransportOutput({ ffmpegPath: ffmpeg, profile, kind,
        settings: kind === "srt" ? { host: "127.0.0.1", port, mode: "caller", latencyMs: 120 } : { url: destination } });
    let timer, recoveredReceiver;
    try {
        await delay(350);
        output.start();
        const frame = Buffer.alloc(profile.width * profile.height * 4, 80);
        const pcm = Buffer.alloc(1920 * 2 * 4);
        for (let i = 0; i < 1920; i++) {
            const value = Math.sin(i * 2 * Math.PI * 1000 / 48000) * 0.1;
            pcm.writeFloatLE(value, i * 8); pcm.writeFloatLE(value, i * 8 + 4);
        }
        timer = setInterval(() => { output.writeAudio(pcm); output.writeVideo(frame); }, 40);
        await delay(10000);
        assert(output.online, `${kind} sender failed: ${output.error || errors}`);
        const firstEncoder = output.process.pid;
        receiver.kill("SIGINT");
        await Promise.race([closed, delay(2000)]);
        const recoveredFile = path.join(folder, kind + "-recovered.ts");
        // Keep supplying the same occurrence while the destination is offline.
        await delay(1500);
        recoveredReceiver = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", ...(kind === "rtmp" ? ["-listen", "1"] : []),
            "-analyzeduration", "500000", "-probesize", "32768", "-i", destination, "-map", "0:v", "-map", "0:a", "-c", "copy", "-y", recoveredFile],
            { stdio: ["ignore", "ignore", "pipe"] });
        recoveredReceiver.stderr.on("data", data => errors += data.toString());
        const recoveredClosed = new Promise(resolve => recoveredReceiver.once("close", resolve));
        for (let attempt = 0; attempt < 150 && !(output.online && output.process?.pid !== firstEncoder); attempt++) await delay(100);
        assert(output.online && output.process?.pid !== firstEncoder && output.reconnects > 0, `${kind} must reconnect the same occurrence`);
        await delay(4000);
        recoveredReceiver.kill("SIGINT");
        await Promise.race([recoveredClosed, delay(2000)]);
        const recoveredInfo = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", recoveredFile], { encoding: "utf8" }));
        assert(recoveredInfo.streams.some(stream => stream.codec_type === "video" && stream.codec_name === "h264"));
        assert(recoveredInfo.streams.some(stream => stream.codec_type === "audio" && stream.codec_name === "aac"));
        assert(Number(recoveredInfo.format.duration) >= 2, `${kind} reconnection must restore sustained A/V`);
        console.log(`${kind.toUpperCase()} recovered destination without advancing or restarting PROGRAM (${output.reconnects} encoder retries)`);
        await delay(500);
        clearInterval(timer);
        output.stop();
        await Promise.race([closed, delay(2000)]);
        assert(fs.statSync(file).size > 0, errors);
        const info = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8" }));
        assert(info.streams.some(stream => stream.codec_type === "video" && stream.codec_name === "h264"));
        assert(info.streams.some(stream => stream.codec_type === "audio" && stream.codec_name === "aac"));
        assert(Number(info.format.duration) >= 2, `${kind} must transmit sustained audio/video`);
        console.log(`${kind.toUpperCase()} loopback: H.264 + AAC received (${Number(info.format.duration).toFixed(1)}s)`);
    } finally { clearInterval(timer); output.stop(); receiver.kill("SIGKILL"); recoveredReceiver?.kill("SIGKILL"); }
}
(async () => {
    assert.throws(() => transportUrl({ url: "https://example.com" }, "rtmp"));
    assert.throws(() => transportUrl({ host: "localhost", port: 0 }, "srt"));
    assert.throws(() => transportUrl({ host: "localhost", port: 9000, passphrase: "short" }, "srt"));
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "santtos-transport-"));
    try { await Promise.all([test("srt", folder), test("rtmp", folder)]); }
    finally { fs.rmSync(folder, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
