"use strict";

/**
 * Relógio monotônico do PROGRAM.
 *
 * O relógio civil pode saltar (NTP, ajuste manual, horário de verão).
 * O playout não pode: PLAY/PAUSE/SEEK e cálculo de posição precisam de
 * uma referência que só avança para a frente.
 */
class ProgramClock {
    constructor({
        monotonicNowNs = () => process.hrtime.bigint(),
        wallNowMs = () => Date.now()
    } = {}) {
        this.monotonicNowNs = monotonicNowNs;
        this.wallNowMs = wallNowMs;
        this.originNs = this.monotonicNowNs();
        this.originWallMs = this.wallNowMs();
    }

    nowMs() {
        const elapsedNs =
            this.monotonicNowNs() -
            this.originNs;

        return Number(elapsedNs) / 1_000_000;
    }

    wallClockMs(atProgramMs = this.nowMs()) {
        return this.originWallMs +
            Math.max(0, Number(atProgramMs) || 0);
    }

    snapshot() {
        const programMs = this.nowMs();

        return {
            kind: "MONOTONIC",
            programMs,
            wallClockMs:
                this.wallClockMs(programMs)
        };
    }
}

module.exports = { ProgramClock };
