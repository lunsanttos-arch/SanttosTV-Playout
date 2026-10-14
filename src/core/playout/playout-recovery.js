"use strict";

const fs = require("node:fs");
const path = require("node:path");

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
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        const temp = this.file + ".tmp";
        const fd = fs.openSync(temp, "w");
        try {
            fs.writeFileSync(fd, JSON.stringify(next), "utf8");
            fs.fsyncSync(fd);
        } finally { fs.closeSync(fd); }
        if (this.primaryValid && fs.existsSync(this.file)) fs.copyFileSync(this.file, this.file + ".bak");
        fs.renameSync(temp, this.file);
        this.state = next;
        this.primaryValid = true;
        return next;
    }

    captureNative(snapshot) {
        if (snapshot.itemId && ["PLAYING", "STARTING", "PAUSED", "FAULT", "ENDED"].includes(snapshot.state)) {
            this.save({ itemId: snapshot.itemId, positionSeconds: snapshot.positionSeconds,
                playing: ["PLAYING", "STARTING"].includes(snapshot.state), ended: snapshot.state === "ENDED" });
        }
    }

    saveAsync(value) {
        // Only keep the most recent waiting checkpoint if the disk is slow.
        // The currently writing checkpoint still completes atomically.
        this.pendingValue = this.normalize(value);
        if (!this.writePromise) this.writePromise = this.writePending().finally(() => { this.writePromise = null; });
        return this.writePromise;
    }

    async writePending() {
        while (this.pendingValue) {
            const next = this.pendingValue; this.pendingValue = null;
            await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
            const temp = this.file + ".tmp";
            const handle = await fs.promises.open(temp, "w", 0o600);
            try { await handle.writeFile(JSON.stringify(next)); await handle.sync(); }
            finally { await handle.close(); }
            if (this.primaryValid) {
                try { await fs.promises.copyFile(this.file, this.file + ".bak"); }
                catch (error) { if (error.code !== "ENOENT") throw error; }
            }
            await fs.promises.rename(temp, this.file);
            this.state = next; this.primaryValid = true;
        }
        return this.state;
    }

    captureNativeAsync(snapshot) {
        if (snapshot.itemId && ["PLAYING", "STARTING", "PAUSED", "FAULT", "ENDED"].includes(snapshot.state)) {
            return this.saveAsync({ itemId: snapshot.itemId, positionSeconds: snapshot.positionSeconds,
                playing: ["PLAYING", "STARTING"].includes(snapshot.state), ended: snapshot.state === "ENDED" });
        }
        return Promise.resolve(this.state);
    }

    flush() { return this.writePromise || Promise.resolve(this.state); }
}

module.exports = { PlayoutRecovery };
