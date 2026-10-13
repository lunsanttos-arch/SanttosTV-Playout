"use strict";
const { spawn } = require("node:child_process");

function transportUrl(settings, kind) {
    if (kind === "rtmp") {
        const parsed = new URL(settings.url);
        if (!["rtmp:", "rtmps:"].includes(parsed.protocol) || !parsed.hostname) throw new Error("Informe uma URL RTMP válida.");
        return settings.url;
    }
    if (!settings.host || !Number.isInteger(Number(settings.port)) || settings.port < 1 || settings.port > 65535) {
        throw new Error("Informe o destino e a porta SRT.");
    }
    const query = new URLSearchParams({ mode: settings.mode || "caller", latency: String((settings.latencyMs || 120) * 1000) });
    if (settings.streamId) query.set("streamid", settings.streamId);
    if (settings.passphrase) {
        if (settings.passphrase.length < 10 || settings.passphrase.length > 79) throw new Error("A senha SRT deve ter de 10 a 79 caracteres.");
        query.set("passphrase", settings.passphrase); query.set("pbkeylen", "32");
    }
    return `srt://${settings.host}:${settings.port}?${query}`;
}

class TransportOutput {
    constructor({ ffmpegPath, profile, settings, kind, onError = null }) {
        Object.assign(this, { ffmpegPath, profile, settings, kind, onError });
        this.process = null; this.error = null;
        this.online = false; this.audioSeen = false;
    }
    start() {
        const url = transportUrl(this.settings, this.kind);
        const p = this.profile;
        const fps = p.fpsN / p.fpsD;
        const bitrate = Math.max(1000000, Math.round(p.width * p.height * fps * 0.10));
        const child = spawn(this.ffmpegPath, ["-hide_banner", "-loglevel", "warning", "-nostdin",
            "-thread_queue_size", "64", "-analyzeduration", "1", "-probesize", "32", "-f", "rawvideo", "-pixel_format", p.ffmpegPixelFormat,
            "-video_size", `${p.width}x${p.height}`, "-framerate", p.fpsExpression, "-i", "pipe:0",
            "-thread_queue_size", "256", "-analyzeduration", "1", "-probesize", "32", "-f", "f32le", "-ar", String(p.sampleRate), "-ac", String(p.channels), "-i", "pipe:3",
            "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
            "-threads", "2", "-pix_fmt", "yuv420p", "-b:v", String(bitrate), "-maxrate", String(bitrate),
            "-bufsize", String(bitrate * 2), "-g", String(Math.round(fps * 2)), "-c:a", "aac", "-b:a", "192k",
            "-ar", String(p.sampleRate), "-ac", String(p.channels), "-progress", "pipe:4", "-stats_period", "0.5",
            "-f", this.kind === "rtmp" ? "flv" : "mpegts", url
        ], { windowsHide: true, stdio: ["pipe", "ignore", "pipe", "pipe", "pipe"] });
        this.process = child;
        const fail = error => {
            this.error = String(error.message || error).replace(/(?:srt|rtmps?):\/\/\S+/g, "[destino]").slice(-500);
            this.onError?.(this.error);
        };
        child.on("error", fail);
        let stderr = "";
        child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-1200); });
        child.stdio[4].on("data", chunk => {
            if (/frame=\s*[1-9]/.test(chunk.toString())) { this.online = true; this.error = null; }
        });
        child.stdin.on("error", fail); child.stdio[3].on("error", fail);
        child.on("close", code => { if (this.process === child) { this.process = null; this.online = false; if (code) fail(stderr || "Transporte encerrou: " + code); } });
        return this;
    }
    writeVideo(frame) {
        const sink = this.process?.stdin;
        if (sink && !sink.destroyed && sink.writableLength <= frame.length * 3) sink.write(frame);
        if (!this.audioSeen) {
            const audio = this.process?.stdio[3];
            if (audio && !audio.destroyed && audio.writableLength < 512 * 1024) {
                audio.write(Buffer.alloc(Math.ceil(this.profile.sampleRate * this.profile.fpsD / this.profile.fpsN) * this.profile.channels * 4));
            }
        }
    }
    writeAudio(pcm) {
        this.audioSeen = true;
        const sink = this.process?.stdio[3];
        if (sink && !sink.destroyed && sink.writableLength <= 512 * 1024) sink.write(pcm);
    }
    stop() {
        this.online = false;
        const child = this.process; this.process = null;
        if (child) {
            child.stdin.destroy();
            child.stdio[3].destroy();
            child.kill();
            const timeout = setTimeout(() => {
                if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
            }, 1000);
            timeout.unref();
            child.once("close", () => clearTimeout(timeout));
        }
    }
}
module.exports = { TransportOutput, transportUrl };
