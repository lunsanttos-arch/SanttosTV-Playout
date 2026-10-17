"use strict";

const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

class OmtOutput {
    constructor({
        runtimeFolder,
        profile,
        onStateChange = null,
        onUnexpectedExit = null
    }) {
        this.runtimeFolder = runtimeFolder;
        this.profile = profile;
        this.onStateChange = onStateChange;
        this.onUnexpectedExit = onUnexpectedExit;

        this.process = null;
        this.audioSocket = null;
        this.audioReconnectTimer = null;
        this.audioPipe = "";
        this.online = false;
        this.audioReady = false;
        this.audioActive = false;
        this.stopping = false;
        this.error = "";
        this.pendingOutput = "";
        this.videoFrames = 0;
        this.videoFramesDropped = 0;
        this.audioBytes = 0;
        this.pendingVideoFrame = null;
        this.videoBlocked = false;
        this.videoDrainTarget = null;
        this.videoDrainListener = null;
        this.videoWriteWaits = 0;
        this.maxVideoWaitMs = 0;
        this.videoStallTimer=null;this.audioBytesDropped=0;this.lastVideoAt=0;this.lastAudioAt=0;this.maxVideoGapMs=0;this.maxAudioGapMs=0;
    }

    executablePath() {
        return path.join(
            this.runtimeFolder,
            "omt_sender.exe"
        );
    }

    runtimeFiles() {
        return {
            executable:
                this.executablePath(),
            libomt:
                path.join(
                    this.runtimeFolder,
                    "libomt.dll"
                ),
            libvmx:
                path.join(
                    this.runtimeFolder,
                    "libvmx.dll"
                )
        };
    }

    validateRuntime() {
        const files =
            this.runtimeFiles();

        for (
            const [name, filePath]
            of Object.entries(files)
        ) {
            if (!fs.existsSync(filePath)) {
                throw new Error(
                    `Runtime OMT ausente: ${name} (${filePath})`
                );
            }
        }

        return files;
    }

    emitState() {
        if (
            typeof this.onStateChange ===
            "function"
        ) {
            this.onStateChange(
                this.snapshot()
            );
        }
    }

    start() {
        if (
            !this.profile?.omtEnabled ||
            this.process
        ) {
            return this.snapshot();
        }

        const files =
            this.validateRuntime();

        this.clearVideoQueue();
        this.videoWriteWaits = 0;
        this.maxVideoWaitMs = 0;
        this.stopping = false;
        this.error = "";
        this.online = false;
        this.audioReady = false;
        this.audioActive = false;
        this.videoFrames = 0;
        this.videoFramesDropped = 0;
        this.audioBytes = 0;

        this.audioPipe =
            "\\\\.\\pipe\\SanttosOmtAudio-" +
            process.pid +
            "-" +
            crypto
                .randomBytes(6)
                .toString("hex");

        const args = [
            "--name",
            this.profile.omtName,
            "--audio-pipe",
            this.audioPipe,
            "--width",
            String(this.profile.width),
            "--height",
            String(this.profile.height),
            "--fps-n",
            String(this.profile.fpsN),
            "--fps-d",
            String(this.profile.fpsD),
            "--scan",
            this.profile.scanMode,
            "--aspect",
            String(this.profile.aspect),
            "--pixel-format",
            this.profile.ndiPixelFormat,
            "--audio-rate",
            String(this.profile.sampleRate),
            "--audio-channels",
            String(this.profile.channels),
            "--quality",
            this.profile.omtQuality
        ];

        const child =
            spawn(
                files.executable,
                args,
                {
                    cwd:
                        this.runtimeFolder,
                    windowsHide: true,
                    stdio: [
                        "pipe",
                        "pipe",
                        "pipe"
                    ]
                }
            );

        this.process = child;
        this.pendingOutput = "";

        child.stdin.on(
            "error",
            (error) => {
                if (
                    this.process !== child ||
                    this.stopping
                ) {
                    return;
                }

                this.error =
                    "Canal de vídeo OMT: " +
                    error.message;

                this.emitState();
            }
        );

        child.stdout.on(
            "data",
            (data) => {
                if (
                    this.process !== child
                ) {
                    return;
                }

                this.pendingOutput +=
                    data.toString();

                let newline;

                while (
                    (
                        newline =
                            this.pendingOutput
                                .indexOf("\n")
                    ) >= 0
                ) {
                    const line =
                        this.pendingOutput
                            .slice(
                                0,
                                newline
                            )
                            .trim();

                    this.pendingOutput =
                        this.pendingOutput
                            .slice(
                                newline + 1
                            );

                    this.handleLine(
                        line
                    );
                }

                if (
                    this.pendingOutput.length >
                    4096
                ) {
                    this.pendingOutput =
                        this.pendingOutput
                            .slice(-4096);
                }
            }
        );

        child.stderr.on(
            "data",
            (data) => {
                const message =
                    data
                        .toString()
                        .trim();

                if (!message) {
                    return;
                }

                this.error =
                    message.slice(
                        -1024
                    );

                console.error(
                    "[OMT] " +
                    this.error
                );

                this.emitState();
            }
        );

        child.on(
            "error",
            (error) => {
                if (
                    this.process !== child
                ) {
                    return;
                }

                this.error =
                    "Não foi possível iniciar OMT: " +
                    error.message;
                this.clearVideoQueue();
                this.process = null;
                this.online = false;
                this.audioReady = false;
                this.audioActive = false;
                this.destroyAudioSocket();
                this.emitState();
                this.onUnexpectedExit?.(this.error);
            }
        );

        child.on(
            "exit",
            (code, signal) => {
                if (
                    this.process !== child
                ) {
                    return;
                }

                this.clearVideoQueue();
                this.process = null;
                this.online = false;
                this.audioReady = false;
                this.audioActive = false;

                this.destroyAudioSocket();

                if (!this.stopping) {
                    this.error = this.error ||
                        `Sender OMT encerrou (código ${code}; sinal ${signal}).`;

                    this.emitState();

                    if (
                        typeof this.onUnexpectedExit ===
                        "function"
                    ) {
                        this.onUnexpectedExit(
                            this.error
                        );
                    }
                } else {
                    this.emitState();
                }
            }
        );

        this.emitState();
        return this.snapshot();
    }

    handleLine(line) {
        if (!line) {
            return;
        }

        console.log(
            "[OMT] " +
            line.slice(0, 1024)
        );

        if (
            line ===
            "OMT AUDIO PIPE READY:" +
                this.audioPipe
        ) {
            this.audioReady = true;
            this.connectAudio();
        }

        if (
            line.startsWith(
                "OMT AUDIO ACTIVE: FPA1 "
            )
        ) {
            this.audioActive = true;
        }

        if (
            line ===
            "OMT ONLINE: " +
                this.profile.omtName
        ) {
            this.online = true;
            this.error = "";
        }

        this.emitState();
    }

    connectAudio() {
        if (
            !this.audioPipe ||
            this.audioSocket
        ) {
            return;
        }

        const socket =
            net.createConnection(
                this.audioPipe
            );

        this.audioSocket =
            socket;

        socket.on(
            "connect",
            () => {
                this.emitState();
            }
        );

        socket.on(
            "error",
            (error) => {
                if (
                    this.audioSocket !==
                    socket
                ) {
                    return;
                }

                this.error =
                    "Pipe de áudio OMT: " +
                    error.message;

                this.emitState();
            }
        );

        socket.on(
            "close",
            () => {
                if (
                    this.audioSocket ===
                    socket
                ) {
                    this.audioSocket =
                        null;

                    this.audioActive =
                        false;

                    this.emitState();

                    if (
                        !this.stopping &&
                        this.process &&
                        this.audioReady &&
                        !this.audioReconnectTimer
                    ) {
                        this.audioReconnectTimer =
                            setTimeout(
                                () => {
                                    this.audioReconnectTimer =
                                        null;

                                    this.connectAudio();
                                },
                                250
                            );
                    }
                }
            }
        );
    }

    canWriteVideo() {
        return Boolean(
            this.online &&
            this.process?.stdin &&
            !this.process.stdin.destroyed
        );
    }

    writeVideo(
        frame,
        {
            allowDrop = true
        } = {}
    ) {
        if (
            !Buffer.isBuffer(frame) ||
            !this.canWriteVideo()
        ) {
            return true;
        }

        const target =
            this.process.stdin;

        if (!allowDrop) {
            this.videoFrames += 1;
            return target.write(frame);
        }

        if (this.videoBlocked) {
            if (this.pendingVideoFrame) this.videoFramesDropped += 1;
            this.pendingVideoFrame = frame;
            return true;
        }
        this.sendVideoFrame(frame, target);
        return true; // OMT pressure never blocks PROGRAM/NDI.
    }

    failRoute(reason) {
        if(this.stopping)return;this.stop();this.error=reason;this.emitState();this.onUnexpectedExit?.(reason);
    }

    clearVideoQueue() {
        clearTimeout(this.videoStallTimer);this.videoStallTimer=null;
        if (this.videoDrainTarget && this.videoDrainListener) {
            this.videoDrainTarget.off("drain", this.videoDrainListener);
            this.videoDrainTarget.off("close", this.videoDrainListener);
        }
        this.pendingVideoFrame = null;
        this.videoBlocked = false;
        this.videoDrainTarget = null;
        this.videoDrainListener = null;
    }

    sendVideoFrame(frame, target) {
        if (target !== this.process?.stdin || target.destroyed || this.stopping) return;
        try {
            const now=performance.now();if(this.lastVideoAt)this.maxVideoGapMs=Math.max(this.maxVideoGapMs,now-this.lastVideoAt);this.lastVideoAt=now;
            this.videoFrames += 1;
            if (target.write(frame)) return;
            this.videoBlocked = true;
            this.videoWriteWaits += 1;
            const started = performance.now();
            this.videoStallTimer=setTimeout(()=>this.failRoute("OMT sem consumir vídeo por 750 ms; reconectando esta saída."),750);
            this.videoDrainTarget = target;
            const release = () => {
                if (this.videoDrainTarget !== target) return;
                const next = this.pendingVideoFrame;
                this.maxVideoWaitMs = Math.max(this.maxVideoWaitMs, performance.now() - started);
                this.clearVideoQueue();
                // Close/restart invalidates the previous sender's pending frame.
                if (next && this.canWriteVideo() && target === this.process?.stdin) this.sendVideoFrame(next, target);
            };
            this.videoDrainListener = release;
            target.once("drain", release);
            target.once("close", release);
        } catch (error) {
            this.failRoute("Canal de vídeo OMT: " + error.message);
        }
    }

    onceVideoDrain(callback) {
        const target =
            this.process?.stdin;

        if (
            !target ||
            target.destroyed
        ) {
            queueMicrotask(
                callback
            );
            return;
        }

        target.once(
            "drain",
            callback
        );
    }

    writeAudio(chunk) {
        if (
            !Buffer.isBuffer(chunk) ||
            chunk.length === 0 ||
            !this.audioSocket ||
            this.audioSocket.destroyed
        ) {
            return;
        }

        // O OMT é uma saída auxiliar. Se o consumidor travar, não deixamos
        // o pipe dele empilhar memória nem seguramos o NDI/monitor local.
        if (
            this.audioSocket.writableLength >
            512 * 1024
        ) {
            this.audioBytesDropped+=chunk.length;this.failRoute("OMT sem consumir áudio: fila PCM cheia; reconectando áudio e vídeo.");
            return;
        }

        const now=performance.now();if(this.lastAudioAt)this.maxAudioGapMs=Math.max(this.maxAudioGapMs,now-this.lastAudioAt);this.lastAudioAt=now;
        this.audioBytes +=
            chunk.length;

        this.audioSocket.write(
            chunk
        );
    }

    destroyAudioSocket() {
        const socket =
            this.audioSocket;

        this.audioSocket = null;

        if (
            socket &&
            !socket.destroyed
        ) {
            socket.destroy();
        }
    }

    stop() {
        this.stopping = true;
        this.clearVideoQueue();

        if (
            this.audioReconnectTimer
        ) {
            clearTimeout(
                this.audioReconnectTimer
            );

            this.audioReconnectTimer =
                null;
        }

        this.online = false;
        this.audioReady = false;
        this.audioActive = false;

        this.destroyAudioSocket();

        const child =
            this.process;

        this.process = null;

        if (
            child &&
            !child.killed
        ) {
            try {
                child.stdin.end();
            } catch {
                // Já encerrado.
            }

            child.kill();
            const deadline = setTimeout(() => {
                if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
            }, 1000);
            deadline.unref();
            child.once?.("close", () => clearTimeout(deadline));
        }

        this.audioPipe = "";
        this.emitState();
    }

    snapshot() {
        return {
            enabled:
                Boolean(
                    this.profile?.omtEnabled
                ),
            online:
                this.online,
            source:
                this.profile?.omtName ??
                "SanTTos Playout - PROGRAM",
            quality:
                this.profile?.omtQuality ??
                "low",
            audioReady:
                this.audioReady,
            audioActive:
                this.audioActive,
            connectedAudio:
                Boolean(
                    this.audioSocket &&
                    !this.audioSocket.destroyed
                ),
            videoFrames:
                this.videoFrames,
            videoFramesDropped:
                this.videoFramesDropped,
            queuedVideoBytes: this.process?.stdin?.writableLength || 0,
            pendingVideoFrames: this.pendingVideoFrame ? 1 : 0,
            videoWriteWaits: this.videoWriteWaits,
            maxVideoWaitMs: this.maxVideoWaitMs,
            audioBytes:
                this.audioBytes,
            queuedAudioBytes:this.audioSocket?.writableLength||0, audioBytesDropped:this.audioBytesDropped,
            maxVideoGapMs:this.maxVideoGapMs,maxAudioGapMs:this.maxAudioGapMs,receiverVerified:false,
            error:
                this.error ||
                null
        };
    }
}

module.exports = {
    OmtOutput
};
