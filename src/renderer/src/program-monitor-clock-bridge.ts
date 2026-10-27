import { programMonitorClock } from "./program-monitor-clock.mjs";

const pending = new Set<string>();
const attemptedAt = new Map<string, number>();
// Calibrate through a round trip, never by treating an old media packet as
// current. PROGRAM and renderer can have different wall-clock origins after a
// service restart or a system clock adjustment; their media clocks stay intact.
export async function synchronizeMonitorClock(streamId?: string) {
    if (!streamId || programMonitorClock.sourceClockKnown(streamId) || pending.has(streamId)) return;
    const before = programMonitorClock.now();
    if (before - (attemptedAt.get(streamId) ?? -Infinity) < 500) return;
    attemptedAt.set(streamId, before);pending.add(streamId);
    if (attemptedAt.size > 32) attemptedAt.delete(attemptedAt.keys().next().value!);
    try {
        const sample = await window.santtosAPI.getProgramMonitorClock();
        const after = programMonitorClock.now();
        if (sample.streamId === streamId && Number.isFinite(sample.emittedAt) && after - before <= 100)
            programMonitorClock.configureSourceClock(streamId, sample.emittedAt - (before + after) / 2);
    } catch { /* A later frame retries without restarting the on-air decoder. */ }
    finally { pending.delete(streamId); }
}
