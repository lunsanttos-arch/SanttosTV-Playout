"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { isRemoteInputUrl, remoteInputArgs } = require("./remote-input");

const execFileAsync = promisify(execFile);
const probeModule = require("@derhuerst/ffprobe-static");
const defaultProbe = typeof probeModule === "string" ? probeModule : probeModule.path ?? probeModule.default;

async function startWarmInputTuner(sourceUrl, {
    ffmpegPath = require("ffmpeg-static"),
    ffprobePath = process.env.FFPROBE_BIN || defaultProbe.replace("app.asar", "app.asar.unpacked"),
    userAgent = "", referer = "", cookie = "",
    timeoutMs = 14000, signal
} = {}) {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "santtos-input-warm-"));
    let child;
    let stopped = false;
    let stderr = "";
    let spawnError = null;
    let sourceDurationKnown = false;
    let inputMetadata = "";
    const server = http.createServer((request, response) => {
        const name = new URL(request.url, "http://127.0.0.1").pathname.slice(1);
        if (!/^(index\.m3u8|segment-\d+\.ts)$/.test(name)) {
            response.writeHead(404); response.end(); return;
        }
        const file = path.join(folder, name);
        const stream = fs.createReadStream(file);
        stream.on("error", () => {
            if (!response.headersSent) response.writeHead(404);
            response.end();
        });
        stream.on("open", () => {
            response.writeHead(200, { "Content-Type": name.endsWith(".m3u8")
                ? "application/vnd.apple.mpegurl" : "video/mp2t", "Cache-Control": "no-store" });
            if (request.method === "HEAD") { stream.destroy(); response.end(); }
            else stream.pipe(response);
        });
        response.on("close", () => stream.destroy());
    });
    const stop = () => {
        if (stopped) return;
        stopped = true;
        signal?.removeEventListener("abort", stop);
        server.close();
        server.closeAllConnections();
        if (child && !child.killed) child.kill();
        const cleanup = () => fs.rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }, () => {});
        if (child && child.exitCode === null && child.signalCode === null) child.once("close", cleanup);
        else cleanup();
    };
    signal?.addEventListener("abort", stop, { once: true });
    try {
        if (signal?.aborted) throw new Error("Pré-carga cancelada.");
        await new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", resolve);
        });
        if (stopped) throw new Error("Pré-carga cancelada.");
        child = spawn(ffmpegPath, [
            "-hide_banner", "-loglevel", "info", "-nostats", "-nostdin",
            "-probesize", "5000000", "-analyzeduration", "3000000",
            ...(isRemoteInputUrl(sourceUrl) ? remoteInputArgs(sourceUrl, { userAgent, referer, cookie }) : []),
            "-i", sourceUrl, "-map", "0:v:0", "-map", "0:a:0?",
            "-c:v", "copy", "-c:a", "copy", "-f", "hls",
            "-hls_time", "1", "-hls_list_size", "3", "-hls_delete_threshold", "2",
            "-hls_flags", "delete_segments+temp_file+omit_endlist",
            "-hls_segment_filename", path.join(folder, "segment-%09d.ts"),
            path.join(folder, "index.m3u8")
        ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
        child.on("error", error => { spawnError = error; });
        child.stderr.on("data", chunk => {
            const text = chunk.toString();
            stderr = (stderr + text).slice(-1800);
            inputMetadata = (inputMetadata + text).slice(-4000);
            if (/Duration:\s*\d+:\d+:\d+/i.test(inputMetadata)) sourceDurationKnown = true;
        });
        const alive = () => !stopped && !spawnError && child.exitCode === null && child.signalCode === null;
        const deadline = Date.now() + timeoutMs;
        let lastSegment = "";
        while (Date.now() < deadline) {
            if (sourceDurationKnown) throw new Error("Fonte gravada: o PROGRAM abrirá do início, sem consumir conteúdo na pré-carga.");
            if (!alive()) throw new Error("Tuner do Input encerrou antes de ficar pronto: " + (spawnError?.message || stderr));
            const playlist = path.join(folder, "index.m3u8");
            if (fs.existsSync(playlist)) {
                const segments = fs.readFileSync(playlist, "utf8").split(/\r?\n/)
                    .filter(line => /^segment-\d+\.ts$/.test(line));
                const segment = segments[segments.length - 1];
                if (segments.length >= 2 && segment && segment !== lastSegment) {
                    lastSegment = segment;
                    try {
                        const { stdout } = await execFileAsync(ffprobePath, [
                            "-v", "error", "-threads", "2", "-count_frames", "-show_entries", "stream=codec_type,nb_read_frames",
                            "-of", "json", path.join(folder, segment)
                        ], { windowsHide: true, timeout: Math.max(100, Math.min(4000, deadline - Date.now())), maxBuffer: 1024 * 1024, signal });
                        const streams = JSON.parse(stdout).streams ?? [];
                        const hasVideo = streams.some(stream => stream.codec_type === "video" && Number(stream.nb_read_frames) > 0);
                        const audio = streams.filter(stream => stream.codec_type === "audio");
                        const hasAudio = audio.some(stream => Number(stream.nb_read_frames) > 0);
                        if (hasVideo && (!audio.length || hasAudio) && alive()) {
                            const isFresh = () => {
                                if (!alive()) return false;
                                try {
                                    const text = fs.readFileSync(playlist, "utf8");
                                    const target = Number(text.match(/#EXT-X-TARGETDURATION:(\d+)/)?.[1]) || 1;
                                    return Date.now() - fs.statSync(playlist).mtimeMs <= Math.max(4000, target * 3000);
                                } catch { return false; }
                            };
                            return { url: `http://127.0.0.1:${server.address().port}/index.m3u8`,
                                ready: true, hasVideo, hasAudio, isAlive: isFresh, stop };
                        }
                    } catch (error) {
                        if (signal?.aborted) throw error;
                        if (error.signal === "SIGSEGV" || error.code === "ENOENT" || error.code === "EACCES") {
                            throw new Error("Não foi possível validar o Input no FFprobe: " + (error.signal || error.code));
                        }
                        // A segment can rotate during validation. Try the next completed segment.
                    }
                }
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error("O Input não entregou um segmento com vídeo decodificável durante a pré-carga." +
            (stderr.trim() ? " " + stderr.trim().slice(-700) : ""));
    } catch (error) { stop(); throw error; }
}

module.exports = { startWarmInputTuner };
