// Anchor the device clock once per monitor epoch. Reading its timestamp for
// every PCM block introduces device timestamp jitter as audible gaps/overlaps.
export class MonitorAudioTimeline {
    reset() { this.anchor = null; this.end = null; }
    constructor() { this.reset(); }
    plan({ epoch, mediaTime, frames, rate, deviceAt }) {
        if (!this.anchor || this.anchor.epoch !== epoch || this.anchor.rate !== rate) {
            this.anchor = { epoch, rate, mediaTime, at: deviceAt }; this.end = null;
        }
        let at = this.anchor.at + mediaTime - this.anchor.mediaTime;
        // A genuine device clock jump needs a shared A/V reset, not a gradual
        // concatenation that lets local sound drift away from the picture.
        if (Math.abs(deviceAt - at) > .08) { this.reset(); return null; }
        if (this.end && Math.abs(mediaTime - this.end.mediaTime) < .5 / rate) at = this.end.at;
        // Keep actual missing packets as gaps: never concatenate across a loss.
        this.end = { mediaTime: mediaTime + frames / rate, at: at + frames / rate };
        return at;
    }
}
