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
        if (snapshot.itemId && ["PLAYING", "STARTING", "PAUSED", "FAULT"].includes(snapshot.state)) {
            this.save({ itemId: snapshot.itemId, positionSeconds: snapshot.positionSeconds,
                playing: ["PLAYING", "STARTING"].includes(snapshot.state) });
        }
    }
}

module.exports = { PlayoutRecovery };
