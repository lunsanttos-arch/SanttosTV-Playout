"use strict";
const { spawn } = require("node:child_process");
const { PassThrough } = require("node:stream");
const { FramePacer } = require("./frame-pacer");
const { FixedFrameAssembler } = require("../ndi/frame-aligner");
const { JpegFrameParser } = require("./program-preview-tap");
const { VideoClockedPcm } = require("../audio/video-clocked-pcm");
const { InputDeadline } = require("./input-deadline");

class DecoderDeck {
    constructor({ executable, args, profile, graphics, source, requireAudio, duration, remote,
        onFrame, onPreview, createAudio, onFirst, onFinish, signal, timeoutMs = 12000 }) {
        Object.assign(this, { profile, graphics, source, requireAudio, duration, remote, onFrame, onPreview, createAudio, onFirst, onFinish });
        this.active = false; this.stopped = false; this.decoded = 0; this.delivered = 0; this.audioBytes = 0;
        this.stderr = ""; this.previews = []; this.previewIndex = 0; this.readyState = false;
        this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
        this.child = spawn(executable, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"] });
        graphics.attach(this.child);
        this.clock = requireAudio ? new VideoClockedPcm(this.child.stdio[4], profile) : null;
        this.clock?.output.on("error", error => this.fail(error));
        this.pacer = new FramePacer({ profile, source: this.child.stdout, reserveMs: remote ? 250 : 0, onFrame: frame => this.deliver(frame) });
        this.pacer.blocked = true; // PREROLL holds decoded frames and PCM until the atomic CUT.
        this.assembler = new FixedFrameAssembler(profile.frameSize, frame => { this.decoded++; this.pacer.push(frame); this.checkReady(); });
        this.child.stdout.on("data", chunk => this.assembler.push(chunk));
        this.child.stdout.on("error", error => this.fail(error));
        this.child.stdio[4].on("data", chunk => { this.audioBytes += chunk.length; this.checkReady(); });
        this.child.stdio[4].on("error", error => this.fail(error));
        const parser = new JpegFrameParser(frame => {
            this.previews.push({ index: ++this.previewIndex, frame });
            if (this.previews.length > 4) this.previews.shift();
        });
        this.child.stdio[3].on("data", chunk => parser.write(chunk));
        this.child.stdio[3].on("error", error => this.fail(error));
        this.child.stderr.on("data", chunk => { this.stderr = (this.stderr + chunk.toString()).slice(-3000); });
        this.child.on("error", error => this.fail(error));
        this.child.on("close", async (code, signal) => {
            if (this.stopped) return;
            if (code !== 0 || signal) return this.fail(Error(`FFmpeg encerrou (${code}/${signal || "-"}): ${this.stderr.slice(-1200)}`));
            if (!this.decoded) return this.fail(Error("Fonte terminou sem entregar vídeo. " + this.stderr.slice(-1200)));
            await this.pacer.end();
            if (this.stopped || !this.active) return;
            const shown = this.delivered * profile.fpsD / profile.fpsN;
            if (!remote && Number.isFinite(duration) && duration - shown > Math.max(.75, 3 * profile.fpsD / profile.fpsN))
                return this.fail(Error(`Arquivo incompleto ou corrompido: terminou ${(duration - shown).toFixed(2)} segundos antes do OUT previsto.`));
            this.finish();
        });
        this.timeout = setTimeout(() => this.fail(Error("Deck não entregou vídeo e áudio prontos em 12 segundos. " + this.stderr.slice(-900))), timeoutMs);
        this.abort = () => this.fail(Error("Preparo do deck cancelado."));
        this.signal = signal; signal?.addEventListener("abort", this.abort, { once: true });
        if (signal?.aborted) this.abort();
    }
    checkReady() {
        const audioBudget = Math.floor(this.profile.sampleRate * this.profile.fpsD / this.profile.fpsN) * this.profile.channels * 4;
        if (this.stopped || this.readyState || !this.decoded || (this.requireAudio && this.audioBytes < audioBudget)) return;
        this.readyState = true; clearTimeout(this.timeout); this.resolveReady(this);
    }
    activate() {
        if (!this.readyState || this.stopped || this.active) throw Error("Deck não está pronto para CUT.");
        this.active = true;
        this.firstFrame = new Promise((resolve, reject) => { this.resolveFirst = resolve; this.rejectFirst = reject; });
        this.silence = this.clock ? null : new PassThrough();
        this.audioSource = this.createAudio(this.clock?.output ?? this.silence);
        if (this.remote && Number.isFinite(this.duration)) this.deadline = new InputDeadline(this.duration, () => this.finish());
        this.pacer.next = performance.now(); this.pacer.resume(); return this.firstFrame;
    }
    deliver(frame) {
        if (!this.active || this.stopped) return false;
        if (!this.delivered) { this.onFirst(); this.deadline?.start(); this.resolveFirst(); }
        this.onFrame(frame);
        if (this.clock) this.clock.advance();
        else {
            const { sampleRate, fpsD, fpsN, channels } = this.profile;
            const count = Math.floor((this.delivered + 1) * sampleRate * fpsD / fpsN) - Math.floor(this.delivered * sampleRate * fpsD / fpsN);
            this.silence.write(Buffer.alloc(count * channels * 4));
        }
        this.delivered++;
        let latest;
        const ratio = this.profile.fpsN / this.profile.fpsD > 30 ? 2 : 1;
        while (this.previews.length && this.previews[0].index <= Math.ceil(this.delivered / ratio)) latest = this.previews.shift().frame;
        if (latest) this.onPreview(latest);
        return true;
    }
    fail(error) {
        if (this.stopped) return;
        this.error = error.message;
        if (!this.readyState) this.rejectReady(error);
        this.rejectFirst?.(error);
        const active = this.active; this.stop();
        if (active) this.onFinish(error);
    }
    finish() {
        if (this.stopped) return;
        this.stop(); this.onFinish(null);
    }
    stop() {
        if (this.stopped) return;
        this.stopped = true; clearTimeout(this.timeout); this.deadline?.stop();
        this.rejectFirst?.(Error("Deck cancelado."));
        this.signal?.removeEventListener("abort", this.abort);
        if (!this.readyState) this.rejectReady(Error("Deck cancelado antes de ficar pronto."));
        this.pacer.stop(); this.assembler.stop(); this.clock?.stop(); this.silence?.destroy(); this.audioSource?.stop();
        this.graphics.stop(); this.source.cleanup();
        for (const pipe of [this.child.stdout, this.child.stdio[3], this.child.stdio[4]]) pipe.resume();
        this.child.kill();
        const timer = setTimeout(() => { if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGKILL"); }, 1000);
        timer.unref(); this.child.once("close", () => clearTimeout(timer));
    }
    snapshot() { return { pid: this.child.pid, ready: this.readyState && !this.stopped, active: this.active, decodedFrames: this.decoded,
        bufferedFrames: this.pacer.queue.length, bufferedAudioBytes: this.clock?.buffered || 0, hasAudio: this.requireAudio, error: this.error || null }; }
}
module.exports = { DecoderDeck };
