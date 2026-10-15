"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { startWarmInputTuner } = require("../src/core/playout/warm-input-tuner");
const ffmpegPath = require("../src/core/media/runtime-paths").resolveMediaRuntime("ffmpeg");

async function main() {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "santtos-live-qa-"));
    let generator;
    let tuner;
    const server = http.createServer((req, res) => {
        const name = new URL(req.url, "http://127.0.0.1").pathname.slice(1);
        if (!/^(index\.m3u8|segment-\d+\.ts)$/.test(name)) { res.writeHead(404); res.end(); return; }
        const stream = fs.createReadStream(path.join(folder, name));
        stream.on("error", () => { if (!res.headersSent) res.writeHead(404); res.end(); });
        stream.on("open", () => {
            res.setHeader("Content-Type", name.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t");
            stream.pipe(res);
        });
        res.on("close", () => stream.destroy());
    });
    try {
        generator = spawn(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-re", "-f", "lavfi",
            "-i", "testsrc2=size=320x180:rate=25", "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000",
            "-c:v", "libx264", "-preset", "ultrafast", "-g", "25", "-c:a", "aac", "-f", "hls",
            "-hls_time", "1", "-hls_list_size", "3", "-hls_flags", "delete_segments+temp_file",
            "-hls_segment_filename", path.join(folder, "segment-%06d.ts"), path.join(folder, "index.m3u8")
        ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
        let generatorError = "";
        generator.stderr.on("data", chunk => { generatorError += chunk; });
        const readyBy = Date.now() + 7000;
        while (!fs.existsSync(path.join(folder, "index.m3u8"))) {
            if (generator.exitCode !== null || Date.now() > readyBy) throw new Error("Live generator failed: " + generatorError);
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
        tuner = await startWarmInputTuner(`http://127.0.0.1:${server.address().port}/index.m3u8`, { ffmpegPath });
        assert(tuner.ready && tuner.hasVideo && tuner.hasAudio, "Readiness requires decoded video and audio");
        const before = await (await fetch(tuner.url)).text();
        assert(!before.includes("#EXT-X-ENDLIST"), "Fixture must be an ongoing live stream");
        let after = before;
        const advancesBy = Date.now() + 6000;
        while (before.match(/MEDIA-SEQUENCE:(\d+)/)?.[1] === after.match(/MEDIA-SEQUENCE:(\d+)/)?.[1] && Date.now() < advancesBy) {
            await new Promise(resolve => setTimeout(resolve, 200));
            after = await (await fetch(tuner.url)).text();
        }
        assert.notEqual(before.match(/MEDIA-SEQUENCE:(\d+)/)?.[1], after.match(/MEDIA-SEQUENCE:(\d+)/)?.[1], "Live sequence must advance");
        const start = performance.now();
        await new Promise((resolve, reject) => {
            const decoder = spawn(ffmpegPath, ["-v", "error", "-probesize", "1000000", "-analyzeduration", "500000",
                "-live_start_index", "-1", "-i", tuner.url, "-frames:v", "1", "-an", "-f", "rawvideo", "pipe:1"
            ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
            let bytes = 0;
            let error = "";
            const timer = setTimeout(() => { decoder.kill(); reject(new Error("Prepared Input did not deliver video")); }, 5000);
            decoder.stdout.on("data", data => { bytes += data.length; });
            decoder.stderr.on("data", data => { error += data; });
            decoder.on("error", reject);
            decoder.on("close", code => { clearTimeout(timer); code === 0 && bytes > 0 ? resolve() : reject(new Error(error)); });
        });
        assert(performance.now() - start < 5000, "Take must use the already received media");
        tuner.stop();
        assert.equal(tuner.isAlive(), false);
        await assert.rejects(fetch(tuner.url));
        const controller = new AbortController();
        const pending = startWarmInputTuner(`http://127.0.0.1:${server.address().port}/index.m3u8`,
            { ffmpegPath, signal: controller.signal });
        const cancelTimer = setTimeout(() => controller.abort(), 200);
        try { await assert.rejects(pending); }
        finally { clearTimeout(cancelTimer); }
        console.log("WARM INPUT QA: APROVADO — live contínuo, A/V decodificados, playlist avançando, take e cleanup.");
    } finally {
        tuner?.stop();
        server.close(); server.closeAllConnections();
        if (generator && generator.exitCode === null && generator.signalCode === null) {
            const closed = new Promise(resolve => generator.once("close", resolve));
            generator.kill(); await closed;
        }
        fs.rmSync(folder, { recursive: true, force: true, maxRetries: 5 });
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
