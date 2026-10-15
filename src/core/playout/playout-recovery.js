"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { openJsonStore } = require("../persistence/json-store");

class PlayoutRecovery {
    constructor(folder) {
        this.file = path.join(folder, "playout-recovery.json");
        this.state = null;
        this.primaryValid = false;
        for (const file of [this.file, this.file + ".bak"]) {
            if (!fs.existsSync(file)) continue;
            try {
                this.state = this.normalize(JSON.parse(fs.readFileSync(file, "utf8")));
                this.primaryValid = file === this.file;
                break;
            } catch (error) {
                console.error("Checkpoint de playout inválido:", file, error.message);
            }
        }
    }

    normalize(value) {
        if (!value || typeof value.itemId !== "string" || !value.itemId ||
            !Number.isFinite(value.positionSeconds) || value.positionSeconds < 0) {
            throw new Error("Checkpoint inválido.");
        }
        return {
            itemId: value.itemId.slice(0, 256),
            positionSeconds: value.positionSeconds,
            playing: value.playing === true,
            rundownFinished: value.rundownFinished === true,
            ended: value.ended === true,
            savedAt: new Date().toISOString()
        };
    }

    save(value) {
        const next = this.normalize(value);
        this.pendingState = next;
        this.store ??= openJsonStore(this.file, () => this.pendingState ?? this.state, { backupValid: this.primaryValid });
        this.store.replace(next);
        return this.store.flush().then(() => {
            this.state = next; this.primaryValid = true;
            return next;
        });
    }

    captureNative(snapshot) {
        if (snapshot.itemId && ["PLAYING", "STARTING", "PAUSED", "FAULT", "ENDED"].includes(snapshot.state)) {
            return this.save({ itemId: snapshot.itemId, positionSeconds: snapshot.positionSeconds,
                playing: ["PLAYING", "STARTING"].includes(snapshot.state), ended: snapshot.state === "ENDED" });
        }
    }

    async saveAsync(value) {
        // A failed writer must reject a Promise, never throw out of the periodic
        // PROGRAM callback. A later checkpoint also retries after disk recovery.
        if (this.store?.error) {
            const next = this.normalize(value);
            this.pendingState = next;
            await this.store.retry();
            this.state = next; this.primaryValid = true;
            return this.state;
        }
        return this.save(value);
    }

    captureNativeAsync(snapshot) {
        if (snapshot.itemId && ["PLAYING", "STARTING", "PAUSED", "FAULT", "ENDED"].includes(snapshot.state)) {
            return this.saveAsync({ itemId: snapshot.itemId, positionSeconds: snapshot.positionSeconds,
                playing: ["PLAYING", "STARTING"].includes(snapshot.state), ended: snapshot.state === "ENDED" });
        }
        return Promise.resolve(this.state);
    }

    flush() { return this.store?.flush() ?? Promise.resolve(this.state); }
}

module.exports = { PlayoutRecovery };
