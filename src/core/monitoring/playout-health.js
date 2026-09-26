"use strict";

/**
 * Passive health monitor of the FFmpeg -> NDI input pipe.
 * Counts decoder output bytes; it does NOT measure NDI receiver delivery.
 * The monitor is advisory: never kill, seek or restart an on-air process.
 */
class PlayoutHealth {
    constructor(options = {}) {
        this.now = options.now || Date.now;
        this.onIncident = options.onIncident || (() => {});
        this.frameBytes = options.frameBytes || 1920 * 1080 * 4;
        this.stallMs = options.stallMs || 8000;
        this.startupMs = options.startupMs || 15000;
        this.startedAt = null;
        this.lastByteAt = null;
        this.bytes = 0;
        this.mediaName = "";
        this.mode = "IDLE";
        this.lastFault = "";
        this.incidents = [];
        this.maxIncidents = 100;
    }

    event(type, detail = "") {
        const record = {
            at: new Date(this.now()).toISOString(),
            type,
            detail: String(detail).slice(0, 300),
            mediaName: this.mediaName
        };
        this.incidents.unshift(record);
        if (this.incidents.length > this.maxIncidents) {
            this.incidents.length = this.maxIncidents;
        }
        try {
            this.onIncident(record);
        } catch (error) {
            // Logging must never interrupt the playout/decoder.
            console.error("Falha ao registrar diagnostico:", error);
        }
        return record;
    }

    start(mediaPath) {
        // Preserve names but never expose/import raw absolute paths into logs.
        this.mediaName = String(mediaPath || "")
            .split(/[\\/]/).pop().slice(0, 160);
        this.startedAt = this.now();
        this.lastByteAt = null;
        this.bytes = 0;
        this.mode = "STARTING";
        this.lastFault = "";
    }

    acceptBytes(size) {
        if (this.startedAt === null || !Number.isSafeInteger(size) || size < 1) return;
        this.bytes += size;
        this.lastByteAt = this.now();
        if (this.mode === "STALLED" || this.mode === "START_DELAY") {
            this.event("FLUXO_RESTABELECIDO", "FFmpeg voltou a produzir bytes de vídeo.");
        }
        this.mode = "FLOWING";
    }

    stop() {
        this.startedAt = null;
        this.lastByteAt = null;
        this.mode = "IDLE";
        this.bytes = 0;
        this.mediaName = "";
        this.lastFault = "";
    }

    fail(message) {
        const detail = String(message || "Falha de playout");
        if (this.mode !== "FAULT" || this.lastFault !== detail) {
            this.event("FALHA_PLAYOUT", detail);
        }
        this.lastFault = detail.slice(0, 300);
        this.startedAt = null;
        this.lastByteAt = null;
        this.mode = "FAULT";
    }

    senderLost(message) {
        this.event("NDI_OFFLINE", message || "Sender NDI interrompido.");
        this.startedAt = null;
        this.lastByteAt = null;
        this.mode = "FAULT";
        this.lastFault = "Sender NDI interrompido";
    }

    senderReady() {
        this.event("NDI_RESTABELECIDO", "Processo sender NDI voltou a sinalizar ONLINE.");
    }

    snapshot(senderOnline = true) {
        const time = this.now();
        const ago = this.lastByteAt === null ? null
            : Math.max(0, time - this.lastByteAt);
        const frames = Math.floor(this.bytes / this.frameBytes);
        if (this.startedAt !== null) {
            if (!senderOnline) {
                if (this.mode !== "NDI_OFFLINE") {
                    this.mode = "NDI_OFFLINE";
                    this.event("NDI_OFFLINE", "Sender indisponível durante o playout.");
                }
            } else if (frames < 1) {
                if (time - this.startedAt >= this.startupMs) {
                    if (this.mode !== "START_DELAY") {
                        this.mode = "START_DELAY";
                        this.event("DEMORA_INICIAL", "FFmpeg ainda não produziu um quadro completo.");
                    }
                } else {
                    this.mode = "STARTING";
                }
            } else if (ago !== null && ago >= this.stallMs) {
                if (this.mode !== "STALLED") {
                    this.mode = "STALLED";
                    this.event("QUADROS_PARADOS", "FFmpeg parou de entregar bytes ao pipe NDI.");
                }
            } else {
                if (this.mode === "STALLED" || this.mode === "START_DELAY" ||
                    this.mode === "NDI_OFFLINE") {
                    this.event("FLUXO_RESTABELECIDO", "Quadros voltaram a fluir.");
                }
                this.mode = "FLOWING";
            }
        }
        return {
            state: this.mode,
            mediaName: this.mediaName,
            decodedFramesApprox: frames,
            bytesProduced: this.bytes,
            lastByteAgoMs: ago,
            runningSeconds: this.startedAt === null
                ? null : Math.floor(Math.max(0, time - this.startedAt) / 1000),
            startedAt: this.startedAt === null
                ? null : new Date(this.startedAt).toISOString(),
            lastFault: this.lastFault || null,
            verifiedReceiver: false
        };
    }

    recent(limit = 10) {
        return this.incidents.slice(0, Math.min(100, Math.max(0, limit)));
    }
}

module.exports = { PlayoutHealth };
