"use strict";

const { spawn } = require("node:child_process");
const net = require("node:net");
const { StereoPcmMeter } = require("./stereo-meter");
const {
    isRemoteInputUrl,
    remoteInputArgs
} = require("../playout/remote-input");

function audioFfmpegArgs(
    filePath,
    streamIndex,
    startSeconds,
    durationSeconds,
    sampleRate = 48000,
    channels = 2,
    protocolHint = "",
    userAgent = "",
    referer = "",
    cookie = ""
) {
    if (typeof filePath !== "string" || !filePath) throw new Error("Mídia de áudio inválida.");
    const explicitStream = Number.isSafeInteger(streamIndex) &&
        streamIndex >= 0 && streamIndex <= 255;
    const normalizedRate = [44100, 48000].includes(Number(sampleRate))
        ? Number(sampleRate) : 48000;
    const normalizedChannels = Number(channels) === 1 ? 1 : 2;
    const args = [
        "-hide_banner", "-loglevel", "warning", "-nostdin",
        "-fflags", "+genpts",
        "-re"
    ];
    const remoteInput =
        isRemoteInputUrl(
            filePath
        );

    if (
        startSeconds > 0 &&
        Number.isFinite(startSeconds) &&
        !remoteInput
    ) {
        args.push(
            "-ss",
            startSeconds.toFixed(3)
        );
    }

    if (remoteInput) {
        args.push(
            ...remoteInputArgs(
                filePath,
                {
                    protocolHint,
                    userAgent,
                    referer,
                    cookie,
                    realtime: false
                }
            )
        );
    }

    args.push("-i", filePath);
    if (durationSeconds !== null && Number.isFinite(durationSeconds) &&
        durationSeconds > 0) {
        args.push("-t", durationSeconds.toFixed(3));
    }
    args.push(
        "-map", explicitStream ? "0:" + streamIndex : "0:a:0", "-vn", "-sn", "-dn",
        "-ac", String(normalizedChannels), "-ar", String(normalizedRate),
        "-c:a", "pcm_f32le",
        "-f", "f32le", "pipe:1"
    );
    return args;
}

class NdiAudioSource {
    constructor(options) {
        this.options = options;
        this.sampleRate = [44100, 48000].includes(Number(options.sampleRate))
            ? Number(options.sampleRate) : 48000;
        this.channels = Number(options.channels) === 1 ? 1 : 2;
        this.meter = new StereoPcmMeter(Date.now, this.channels);
        this.status = "STARTING";
        this.error = "";
        this.stopped = false;
        this.child = null;
        this.socket = null;
        this.audioBytesSent = 0;
        this.connected = false;
    }

    start() {
        const { pipePath = "", ffmpegPath, filePath, streamIndex,
            startSeconds = 0, durationSeconds = null,
            protocolHint = "", userAgent = "", referer = "", cookie = "",
            onPcmData = null } = this.options;

        const hasNdiPipe =
            typeof pipePath === "string" &&
            pipePath.startsWith("\\\\.\\pipe\\SanttosAudio-");

        if (pipePath && !hasNdiPipe) {
            throw new Error("Canal NDI de áudio não autorizado.");
        }

        const args = audioFfmpegArgs(
            filePath,
            streamIndex,
            startSeconds,
            durationSeconds,
            this.sampleRate,
            this.channels,
            protocolHint,
            userAgent,
            referer,
            cookie
        );

        const startDecoder = (socket = null) => {
            if (this.stopped) {
                socket?.destroy();
                return;
            }

            this.connected =
                Boolean(socket);
            this.child = spawn(ffmpegPath, args, {
                windowsHide: true,
                stdio: ["ignore", "pipe", "pipe"]
            });

            const child =
                this.child;
            let ffmpegError = "";

            child.stdout.on("data", (chunk) => {
                if (this.stopped || this.child !== child) return;

                this.meter.write(chunk);
                this.audioBytesSent += chunk.length;
                this.status = "FLOWING";

                if (typeof onPcmData === "function") {
                    try {
                        onPcmData(
                            chunk,
                            this.sampleRate,
                            this.channels
                        );
                    } catch {
                        // Monitor local nunca pode interromper o playout.
                    }
                }
            });

            if (socket) {
                child.stdout.pipe(
                    socket,
                    { end: true }
                );
            }

            child.stderr.on("data", data => {
                ffmpegError =
                    (ffmpegError + data.toString())
                        .slice(-700);
            });

            child.on(
                "error",
                err =>
                    this.fail(
                        "FFmpeg áudio: " +
                        err.message
                    )
            );

            child.on("exit", (code, signal) => {
                if (this.stopped || this.child !== child) return;

                this.child = null;
                this.status =
                    code === 0 && !signal
                        ? "ENDED"
                        : "ERROR";

                if (this.status === "ERROR") {
                    this.error =
                        "Decodificação de áudio falhou: " +
                        (
                            ffmpegError ||
                            ("código " + code)
                        );
                }

                socket?.end();
            });
        };

        if (!hasNdiPipe) {
            startDecoder();
            return this;
        }

        const socket =
            net.createConnection(pipePath);
        this.socket = socket;

        socket.on("connect", () => {
            startDecoder(socket);
        });

        socket.on("error", err => {
            if (!this.stopped) {
                this.fail(
                    "Pipe de áudio NDI: " +
                    err.message
                );
            }
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
            if (this.socket) {
                this.child.stdout.unpipe(this.socket);
            }
            if (!this.child.killed) this.child.kill();
        }
        if (this.socket) this.socket.destroy();
        this.meter.reset();
        this.status = "IDLE";
        this.connected = false;
    }

    snapshot() {
        const meter =
            this.meter.snapshot();

        return {
            state: this.status,
            error: this.error || null,
            connected: this.connected,
            active:
                this.status === "FLOWING" &&
                meter.active === true,
            routedToNdi:
                this.connected,
            bytesSent: this.audioBytesSent,
            sampleRate: this.sampleRate,
            channels: this.channels,
            ...meter
        };
    }
}

module.exports = { NdiAudioSource, audioFfmpegArgs };
