"use strict";

function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

class NativePlayoutEngine {
    constructor({ now = () => Date.now() } = {}) {
        this.now = now;
        this.generation = 0;
        this.state = "IDLE";
        this.filePath = null;
        this.itemId = null;
        this.inPointSeconds = 0;
        this.outPointSeconds = null;
        this.anchorPositionSeconds = 0;
        this.anchorAtMs = null;
        this.lastError = null;
    }

    clampPosition(value) {
        const minimum = Math.max(0, finiteNumber(this.inPointSeconds, 0));
        const requested = Math.max(minimum, finiteNumber(value, minimum));
        if (Number.isFinite(this.outPointSeconds)) {
            return Math.min(requested, this.outPointSeconds);
        }
        return requested;
    }

    positionSeconds(atMs = this.now()) {
        let position = this.anchorPositionSeconds;
        if (this.state === "PLAYING" && this.anchorAtMs !== null) {
            position += Math.max(0, atMs - this.anchorAtMs) / 1000;
        }
        return this.clampPosition(position);
    }

    start({
        filePath,
        itemId = null,
        inPointSeconds = 0,
        startSeconds = inPointSeconds,
        outPointSeconds = null
    }) {
        this.generation += 1;
        this.filePath = typeof filePath === "string" ? filePath : null;
        this.itemId = typeof itemId === "string" ? itemId : null;
        this.inPointSeconds = Math.max(0, finiteNumber(inPointSeconds, 0));
        const normalizedOut =
            outPointSeconds === null ||
            outPointSeconds === undefined
                ? null
                : Number(outPointSeconds);
        this.outPointSeconds =
            normalizedOut !== null &&
            Number.isFinite(normalizedOut)
                ? Math.max(
                      this.inPointSeconds,
                      normalizedOut
                  )
                : null;
        this.anchorPositionSeconds = this.clampPosition(startSeconds);
        this.anchorAtMs = this.now();
        this.state = "PLAYING";
        this.lastError = null;
        return this.snapshot();
    }

    pause() {
        if (this.state === "PLAYING") {
            this.anchorPositionSeconds = this.positionSeconds();
            this.anchorAtMs = null;
            this.state = "PAUSED";
        }
        return this.snapshot();
    }

    seek(positionSeconds) {
        this.anchorPositionSeconds = this.clampPosition(positionSeconds);
        this.anchorAtMs = this.state === "PLAYING" ? this.now() : null;
        if (this.state === "ENDED" && (
            this.outPointSeconds === null ||
            this.anchorPositionSeconds < this.outPointSeconds
        )) {
            this.state = "PAUSED";
        }
        return this.snapshot();
    }

    stop() {
        this.anchorPositionSeconds = this.inPointSeconds;
        this.anchorAtMs = null;
        this.state = "IDLE";
        this.lastError = null;
        return this.snapshot();
    }

    complete() {
        this.anchorPositionSeconds = Number.isFinite(this.outPointSeconds)
            ? this.outPointSeconds
            : this.positionSeconds();
        this.anchorAtMs = null;
        this.state = "ENDED";
        return this.snapshot();
    }

    fault(message) {
        this.anchorPositionSeconds = this.positionSeconds();
        this.anchorAtMs = null;
        this.state = "FAULT";
        this.lastError = String(message || "Falha no motor de playout.");
        return this.snapshot();
    }

    snapshot(atMs = this.now()) {
        const positionSeconds = this.positionSeconds(atMs);
        const remainingSeconds = Number.isFinite(this.outPointSeconds)
            ? Math.max(0, this.outPointSeconds - positionSeconds)
            : null;

        return {
            generation: this.generation,
            state: this.state,
            filePath: this.filePath,
            itemId: this.itemId,
            inPointSeconds: this.inPointSeconds,
            outPointSeconds: this.outPointSeconds,
            positionSeconds,
            remainingSeconds,
            active: this.state === "PLAYING",
            paused: this.state === "PAUSED",
            ended: this.state === "ENDED",
            error: this.lastError
        };
    }
}

module.exports = { NativePlayoutEngine };
