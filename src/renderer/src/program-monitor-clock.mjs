// One presentation timeline for local PCM and JPEG. Never controls PROGRAM.
export class ProgramMonitorClock {
    constructor(now = () => performance.timeOrigin + performance.now()) {
        this.previewVisible = true; this.background = false; this.visibilityGrace = 0; this.delayMs = 120; this.now = now; this.epoch = 0; this.generation = -1; this.anchor = null;
        this.streamId = null; this.retiredStreams = new Set();
        this.sourceClocks = new Map();this.lastPacketAgeMs = null;
        this.lastDrawAt = null; this.lastVideoTime = null; this.listeners = new Set();
        this.metrics = { resets: 0, staleVideo: 0, staleAudio: 0, videoStalls: 0, draws: 0 };
    }
    subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    notify(reset = false) { for (const listener of this.listeners) listener(reset); }
    reset(generation = this.generation, streamId = this.streamId) {
        if (this.streamId !== null && streamId !== this.streamId) this.retiredStreams.add(this.streamId);
        if (this.retiredStreams.size > 32) this.retiredStreams.delete(this.retiredStreams.values().next().value);
        this.streamId = streamId;
        this.generation = generation; this.epoch++; this.anchor = null;
        this.lastDrawAt = null; this.lastVideoTime = null; this.metrics.resets++; this.notify(true);
    }
    configureAudioLatency(seconds) {
        const latency = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
        const delay = Math.min(1000, Math.max(250, Math.ceil(latency * 1000 + 120)));
        if (delay !== this.delayMs) { this.delayMs = delay; this.reset(); }
    }
    configureSourceClock(streamId, offsetMs) {
        if (typeof streamId !== 'string' || !streamId || !Number.isFinite(offsetMs)) return;
        const previous = this.sourceClocks.get(streamId) ?? 0;
        this.sourceClocks.set(streamId, offsetMs);
        if (this.sourceClocks.size > 32) this.sourceClocks.delete(this.sourceClocks.keys().next().value);
        if (streamId === this.streamId && Math.abs(offsetMs - previous) > 10) this.reset();
    }
    sourceClockKnown(streamId) { return this.sourceClocks.has(streamId); }
    emittedAt(payload) { return payload.emittedAt - (this.sourceClocks.get(payload.streamId) ?? 0); }
    fresh(payload, maxAge = 250) {
        const age = this.now() - this.emittedAt(payload);
        this.lastPacketAgeMs = Number.isFinite(age) ? age : null;
        return typeof payload.streamId === 'string' && payload.streamId.length > 0 && payload.streamId.length <= 128 &&
            !this.retiredStreams.has(payload.streamId) && Number.isSafeInteger(payload.generation) &&
            (payload.streamId !== this.streamId || payload.generation >= this.generation) &&
            Number.isFinite(payload.mediaTimeSeconds) && payload.mediaTimeSeconds >= 0 &&
            Number.isFinite(age) && age >= -100 && age <= maxAge;
    }
    video(payload) {
        if (!this.fresh(payload) || !Number.isFinite(payload.programTimeSeconds) ||
            payload.programTimeSeconds - payload.mediaTimeSeconds > .12 ||
            payload.mediaTimeSeconds - payload.programTimeSeconds > .05) {
            this.metrics.staleVideo++; return null;
        }
        const anchor = this.emittedAt(payload) - payload.programTimeSeconds * 1000;
        if (payload.streamId !== this.streamId || payload.generation !== this.generation || this.anchor === null || Math.abs(anchor - this.anchor) > 100)
            this.reset(payload.generation, payload.streamId);
        if (this.anchor === null) this.anchor = anchor;
        const plan = { epoch: this.epoch, generation: this.generation,
            deadline: this.anchor + payload.mediaTimeSeconds * 1000 + this.delayMs, mediaTimeSeconds: payload.mediaTimeSeconds };
        if (!this.valid(plan)) { this.metrics.staleVideo++; return null; }
        return plan;
    }
    valid(plan) { return plan.epoch === this.epoch && this.now() - plan.deadline <= 60; }
    presented(plan) {
        if (!this.valid(plan) || (this.lastVideoTime !== null && plan.mediaTimeSeconds < this.lastVideoTime)) return false;
        this.lastDrawAt = this.now(); this.lastVideoTime = plan.mediaTimeSeconds;
        this.visibilityGrace = 0; this.metrics.draws++; this.notify(); return true;
    }
    setBackground(value) {
        if (this.background === value) return;
        this.background = value;
        if (!value) this.visibilityGrace = this.now() + this.delayMs + 250;
    }
    setPreviewVisible(value) {
        if (this.previewVisible === value) return;
        this.previewVisible = value;
        if (value) this.visibilityGrace = this.now() + this.delayMs + 250;
    }
    checkStall() {
        if (!this.previewVisible || this.background || this.now() < this.visibilityGrace) return false;
        if (this.lastDrawAt !== null && this.now() - this.lastDrawAt > 150) {
            this.metrics.videoStalls++; this.reset(); return true;
        }
        return false;
    }
    audio(payload) {
        if (!this.fresh(payload, Math.max(250, this.delayMs + 60))) {
            this.metrics.staleAudio++; return { status: 'drop' };
        }
        if ((!this.previewVisible || this.background) && (payload.streamId !== this.streamId || payload.generation > this.generation || this.anchor === null)) {
            this.reset(payload.generation, payload.streamId);
            this.anchor = this.emittedAt(payload) - payload.mediaTimeSeconds * 1000;
        }
        if (payload.streamId !== this.streamId || payload.generation > this.generation) return { status: 'wait' };
        if (this.anchor === null || (this.lastDrawAt === null && this.previewVisible && !this.background && this.now() >= this.visibilityGrace)) return { status: 'wait' };
        if (this.checkStall()) return { status: 'drop' };
        const deadline = this.anchor + payload.mediaTimeSeconds * 1000 + this.delayMs;
        if (this.now() - deadline > 60 || deadline > this.now() + this.delayMs + 130) {
            this.metrics.staleAudio++; return { status: 'drop' };
        }
        return { status: 'play', deadline, epoch: this.epoch };
    }
    snapshot() { return { ...this.metrics, epoch: this.epoch, generation: this.generation,
        streamId:this.streamId,sourceClockOffsetMs:this.sourceClocks.get(this.streamId)??null,lastPacketAgeMs:this.lastPacketAgeMs,
        videoAgeMs: this.lastDrawAt === null ? null : this.now() - this.lastDrawAt, videoTime: this.lastVideoTime }; }
}
export const programMonitorClock = new ProgramMonitorClock();
