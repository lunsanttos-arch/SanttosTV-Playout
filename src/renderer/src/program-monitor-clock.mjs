// One presentation timeline for local PCM and JPEG. Never controls PROGRAM.
export class ProgramMonitorClock {
    constructor(now = () => performance.timeOrigin + performance.now()) {
        this.now = now; this.epoch = 0; this.generation = -1; this.anchor = null;
        this.streamId = null; this.retiredStreams = new Set();
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
    fresh(payload) {
        const age = this.now() - payload.emittedAt;
        return typeof payload.streamId === 'string' && payload.streamId.length > 0 && payload.streamId.length <= 128 &&
            !this.retiredStreams.has(payload.streamId) && Number.isSafeInteger(payload.generation) &&
            (payload.streamId !== this.streamId || payload.generation >= this.generation) &&
            Number.isFinite(payload.mediaTimeSeconds) && payload.mediaTimeSeconds >= 0 &&
            Number.isFinite(age) && age >= -100 && age <= 250;
    }
    video(payload) {
        if (!this.fresh(payload) || !Number.isFinite(payload.programTimeSeconds) ||
            payload.programTimeSeconds - payload.mediaTimeSeconds > .12 ||
            payload.mediaTimeSeconds - payload.programTimeSeconds > .05) {
            this.metrics.staleVideo++; return null;
        }
        const anchor = payload.emittedAt - payload.programTimeSeconds * 1000;
        if (payload.streamId !== this.streamId || payload.generation !== this.generation || this.anchor === null || Math.abs(anchor - this.anchor) > 100)
            this.reset(payload.generation, payload.streamId);
        if (this.anchor === null) this.anchor = anchor;
        const plan = { epoch: this.epoch, generation: this.generation,
            deadline: this.anchor + payload.mediaTimeSeconds * 1000 + 120, mediaTimeSeconds: payload.mediaTimeSeconds };
        if (!this.valid(plan)) { this.metrics.staleVideo++; return null; }
        return plan;
    }
    valid(plan) { return plan.epoch === this.epoch && this.now() - plan.deadline <= 60; }
    presented(plan) {
        if (!this.valid(plan) || (this.lastVideoTime !== null && plan.mediaTimeSeconds < this.lastVideoTime)) return false;
        this.lastDrawAt = this.now(); this.lastVideoTime = plan.mediaTimeSeconds;
        this.metrics.draws++; this.notify(); return true;
    }
    checkStall() {
        if (this.lastDrawAt !== null && this.now() - this.lastDrawAt > 150) {
            this.metrics.videoStalls++; this.reset(); return true;
        }
        return false;
    }
    audio(payload) {
        if (!this.fresh(payload)) {
            this.metrics.staleAudio++; return { status: 'drop' };
        }
        if (payload.streamId !== this.streamId || payload.generation > this.generation) return { status: 'wait' };
        if (this.anchor === null || this.lastDrawAt === null) return { status: 'wait' };
        if (this.checkStall()) return { status: 'drop' };
        const deadline = this.anchor + payload.mediaTimeSeconds * 1000 + 120;
        if (this.now() - deadline > 60 || deadline > this.now() + 250) {
            this.metrics.staleAudio++; return { status: 'drop' };
        }
        return { status: 'play', deadline, epoch: this.epoch };
    }
    snapshot() { return { ...this.metrics, epoch: this.epoch, generation: this.generation,
        videoAgeMs: this.lastDrawAt === null ? null : this.now() - this.lastDrawAt, videoTime: this.lastVideoTime }; }
}
export const programMonitorClock = new ProgramMonitorClock();
