"use strict";

const { spawn } = require("node:child_process");
const net = require("node:net");
const { StereoPcmMeter } = require("./stereo-meter");

function audioFfmpegArgs(filePath, streamIndex, startSeconds, durationSeconds) {
    if (typeof filePath !== "string" || !filePath) throw new Error("Mídia de áudio inválida.");
    if (!Number.isSafeInteger(streamIndex) || streamIndex < 0 || streamIndex > 255) {
        throw new Error("Selecione uma faixa de áudio analisada.");
    }
    const args = [
        "-hide_banner", "-loglevel", "warning", "-nostdin",
        "-fflags", "+genpts",
        "-re"
    ];
    if (startSeconds > 0 && Number.isFinite(startSeconds)) {
        args.push("-ss", startSeconds.toFixed(3));
    }
    args.push("-i", filePath);
    if (durationSeconds !== null && Number.isFinite(durationSeconds) &&
        durationSeconds > 0) {
        args.push("-t", durationSeconds.toFixed(3));
    }
    args.push(
        "-map", "0:" + streamIndex, "-vn", "-sn", "-dn",
        "-ac", "2", "-ar", "48000", "-c:a", "pcm_f32le",
        "-f", "f32le", "pipe:1"
    );
    return args;
}

class NdiAudioSource {
    constructor(options) {
        this.options = options;
        this.meter = new StereoPcmMeter();
        this.status = "STARTING";
        this.error = "";
        this.stopped = false;
        this.child = null;
        this.socket = null;
        this.audioBytesSent = 0;
        this.connected = false;
    }

    start() {
        const { pipePath, ffmpegPath, filePath, streamIndex,
            startSeconds = 0, durationSeconds = null } = this.options;
        if (!pipePath || !pipePath.startsWith("\\\\.\\pipe\\SanttosAudio-")) {
            throw new Error("Canal NDI de áudio não autorizado.");
        }
        const args = audioFfmpegArgs(filePath, streamIndex, startSeconds, durationSeconds);
        const socket = net.createConnection(pipePath);
        this.socket = socket;
        socket.on("connect", () => {
            if (this.stopped) { socket.destroy(); return; }
            this.connected = true;
            this.child = spawn(ffmpegPath, args, {
                windowsHide: true,
                stdio: ["ignore", "pipe", "pipe"]
            });
            const child = this.child;
            child.stdout.on("data", (chunk) => {
                if (this.stopped || this.child !== child) return;
                this.meter.write(chunk);
                this.audioBytesSent += chunk.length;
                this.status = "FLOWING";
            });
            child.stdout.pipe(socket, { end: true }); // built-in backpressure
            let ffmpegError = "";
            child.stderr.on("data", data => {
                ffmpegError = (ffmpegError + data.toString()).slice(-700);
            });
            child.on("error", err => this.fail("FFmpeg áudio: " + err.message));
            child.on("exit", (code, signal) => {
                if (this.stopped || this.child !== child) return;
                this.child = null;
                this.status = code === 0 && !signal ? "ENDED" : "ERROR";
                if (this.status === "ERROR") {
                    this.error = "Decodificação de áudio falhou: " +
                        (ffmpegError || ("código " + code));
                }
                socket.end();
            });
        });
        socket.on("error", err => {
            if (!this.stopped) this.fail("Pipe de áudio NDI: " + err.message);
        });
        socket.on("close", () => {
            this.connected = false;
        });
        return this;
    }

    fail(error) {
        if (this.stopped) return;
        this.status = "ERROR";
        this.error = String(error).slice(0, 350);
        if (this.child && !this.child.killed) this.child.kill();
        if (this.socket) this.socket.destroy();
    }

    stop() {
        this.stopped = true;
        if (this.child) {
            this.child.stdout.unpipe(this.socket);
            if (!this.child.killed) this.child.kill();
        }
        if (this.socket) this.socket.destroy();
        this.meter.reset();
        this.status = "IDLE";
        this.connected = false;
    }

    snapshot() {
        return {
            state: this.status,
            error: this.error || null,
            connected: this.connected,
            bytesSent: this.audioBytesSent,
            ...this.meter.snapshot()
        };
    }
}

module.exports = { NdiAudioSource, audioFfmpegArgs };
