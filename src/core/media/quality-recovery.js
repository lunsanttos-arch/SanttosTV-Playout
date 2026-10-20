"use strict";
// Conservative exception for the distributor's tiny empty H.264 access unit.
// Other decode faults, unknown frame counts and substantial loss stay blocked.
function assessRecovery({ frames, stderr, progressEnd, lastSeconds, expected, duration, logOverflow }) {
    if (logOverflow || !progressEnd || !Number.isSafeInteger(expected) || expected <= 0 || !Number.isSafeInteger(frames) ||
        frames <= 0 || expected - frames < 0 || expected - frames > 1 || !Number.isFinite(duration) || duration <= 0 ||
        !Number.isFinite(lastSeconds) || lastSeconds < duration - .25) return null;
    const lines = stderr.trim().split(/\r?\n/).filter(Boolean);
    const smallUnit = /missing picture in access unit with size (?:[1-9]|[12][0-9]|3[0-2])(?:\D|$)/;
    if (!lines.length || lines.length > 8 || !lines.some(line => smallUnit.test(line))) return null;
    const allowed = [smallUnit, /\] no frame!$/, /\] Error submitting packet to decoder: Invalid data found when processing input$/,
        /\] Error while decoding stream #[0-9]+:[0-9]+: Invalid data found when processing input$/];
    if (lines.some(line => !allowed.some(pattern => pattern.test(line)))) return null;
    return { mode: "bounded-h264-recovery", expectedFrames: expected, decodedFrames: frames,
        missingFrames: expected - frames, durationSeconds: duration, lastSeconds };
}
module.exports = { assessRecovery };
