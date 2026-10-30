"use strict";
const { spawn } = require("node:child_process");

function transportUrl(settings, kind) {
    if (kind === "rtmp") {
        const parsed = new URL(settings.url);
        if (!["rtmp:", "rtmps:"].includes(parsed.protocol) || !parsed.hostname) throw new Error("Informe uma URL RTMP válida.");
        return settings.url;
    }
    const mode = settings.mode || "caller";
    if (!["caller", "listener", "rendezvous"].includes(mode)) throw new Error("Modo SRT inválido.");
    const host = mode === "listener" ? "0.0.0.0" : String(settings.host || "").trim();
    if (!host || /[\s/?#@]/.test(host) || !Number.isInteger(Number(settings.port)) || settings.port < 1 || settings.port > 65535) {
        throw new Error("Informe o destino e a porta SRT.");
    }
    const query = new URLSearchParams({ mode, transtype: "live", latency: String((settings.latencyMs || 120) * 1000) });
    if (settings.streamId) query.set("streamid", settings.streamId);
    if (settings.passphrase) {
        if (settings.passphrase.length < 10 || settings.passphrase.length > 79) throw new Error("A senha SRT deve ter de 10 a 79 caracteres.");
        query.set("passphrase", settings.passphrase); query.set("pbkeylen", "32");
    }
    const address = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
    return `srt://${address}:${settings.port}?${query}`;
}

class TransportOutput {
    constructor({ ffmpegPath, profile, settings, kind, onError = null, onRecovered = null }) {
        Object.assign(this, { ffmpegPath, profile, settings, kind, onError, onRecovered });
        this.process = null; this.error = null;
        this.connected = false; this.startupVideoFrames = 0; this.startupAudioBytes = 0;
        this.online = false; this.audioSeen = false; this.stopping = false; this.retryTimer = null; this.attempts = 0; this.reconnects = 0;
    }
    start() {
        this.stopping = false; clearTimeout(this.retryTimer); this.retryTimer = null;
        if (this.process) return this;
        this.audioSeen = false; this.connected = false; this.connectedAt = null; this.startupVideoFrames = 0; this.startupAudioBytes = 0; this.startedAt = Date.now();
        const url = transportUrl(this.settings, this.kind);
        const p = this.profile;
        const fps = p.fpsN / p.fpsD;
        const bitrate = Math.max(1000000, Math.round(p.width * p.height * fps * 0.10));
        const child = spawn(this.ffmpegPath, ["-hide_banner", "-loglevel", "info", "-nostdin",
            "-thread_queue_size", "4", "-analyzeduration", "1", "-probesize", "32", "-f", "rawvideo", "-pixel_format", p.ffmpegPixelFormat,
            "-video_size", `${p.width}x${p.height}`, "-framerate", p.fpsExpression, "-i", "pipe:0",
            "-thread_queue_size", "256", "-analyzeduration", "1", "-probesize", "32", "-f", "f32le", "-ar", String(p.sampleRate), "-ac", String(p.channels), "-i", "pipe:3",
            "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
            "-threads", "2", "-pix_fmt", "yuv420p", "-b:v", String(bitrate), "-maxrate", String(bitrate),
            "-bufsize", String(bitrate * 2), "-g", String(Math.round(fps * 2)), "-c:a", "aac", "-b:a", "192k",
            "-ar", String(p.sampleRate), "-ac", String(p.channels), "-progress", "pipe:4", "-stats_period", "0.5",
            "-f", this.kind === "rtmp" ? "flv" : "mpegts", url
        ], { windowsHide: true, stdio: ["pipe", "ignore", "pipe", "pipe", "pipe"] });
        this.process = child;
        const fail = error => { if (this.process === child && !this.stopping) this.recover(error); };
        child.on("error", fail);
        let stderr = "";
        child.stderr.on("data", chunk => {
            const text = stderr + chunk.toString();
            if (this.process === child && /Output #0, (?:mpegts|flv),/.test(text)) this.markConnected();
            stderr = text.slice(-2400);
        });
        child.stdio[4].on("data", chunk => {
            if (this.process === child && /frame=\s*[1-9]/.test(chunk.toString())) { const wasOffline = !this.online; this.markConnected(); this.online = true; this.error = null; this.attempts = 0; if (wasOffline) this.onRecovered?.(); }
        });
        child.stdin.on("error", fail); child.stdio[3].on("error", fail);
        child.on("close", code => { if (this.process === child && !this.stopping) fail(stderr || "Transporte encerrou: " + code); });
        return this;
    }
    markConnected() {
        if (!this.connected) this.connectedAt = Date.now();
        this.connected = true;
    }
    warmingUp() {
        // A listener may wait indefinitely before a receiver arrives. Allow its
        // bounded initial A/V backlog to drain after connection, not only in the
        // first five seconds after launching FFmpeg.
        return Date.now() - Math.max(this.startedAt || 0, this.connectedAt || 0) < 5000;
    }
    recover(error) {
        if (this.stopping || this.retryTimer) return;
        this.error = String(error.message || error).replace(/(?:srt|rtmps?):\/\/\S+/g, "[destino]").slice(-500);
        this.connected = false; this.online = false; this.onError?.(this.error);
        const child = this.process; this.process = null;
        if (child) { child.stdin.destroy(); child.stdio[3].destroy(); child.kill();
            const kill = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, 1000);
            kill.unref(); child.once("close", () => clearTimeout(kill)); }
        const delay = Math.min(15000, 1000 * 2 ** Math.min(this.attempts++,4));
        this.reconnects += 1;
        this.retryTimer = setTimeout(() => { this.retryTimer = null; if (!this.stopping) { try { this.start(); } catch (error) { this.recover(error); } } }, delay);
        this.retryTimer.unref();
    }
    writeVideo(frame) {
        const sink = this.process?.stdin;
        if (!sink || sink.destroyed) return;
        // Supply enough A/V to open the muxer, then wait for connection instead
        // of repeatedly killing a healthy SRT listener for lack of a receiver.
        if (!this.connected && this.startupVideoFrames >= 8) return;
        this.startupVideoFrames++;
        if (sink.writableLength > frame.length * (this.warmingUp() ? Math.max(3, Math.min(120, Math.floor(64 * 1024 * 1024 / frame.length))) : 3)) return this.recover("Encoder sem consumir vídeo; reconectando áudio e vídeo juntos.");
        sink.write(frame);
    }
    writeAudio(pcm) {
        this.audioSeen = true;
        const sink = this.process?.stdio[3];
        if (!sink || sink.destroyed) return;
        if (!this.connected) {
            const p = this.profile;
            const limit = Math.floor(8 * p.sampleRate * p.fpsD / p.fpsN) * p.channels * 4;
            const remaining = limit - this.startupAudioBytes;
            if (remaining <= 0) return;
            pcm = pcm.subarray(0, Math.min(pcm.length, remaining));
            this.startupAudioBytes += pcm.length;
        }
        if (sink.writableLength > (this.warmingUp() ? 4 * 1024 * 1024 : 512 * 1024)) return this.recover("Encoder sem consumir áudio; reconectando áudio e vídeo juntos.");
        sink.write(pcm);
    }
    stop() {
        this.stopping = true; clearTimeout(this.retryTimer); this.retryTimer = null;
        this.connected = false; this.online = false;
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
