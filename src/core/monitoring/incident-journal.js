"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Append-only, bounded incident log stored OUTSIDE the executable.
// A truncated last line after a power cut is safely ignored on next launch.
class IncidentJournal {
    constructor(userDataPath, options = {}) {
        if (typeof userDataPath !== "string" || !path.isAbsolute(userDataPath)) {
            throw new TypeError("Pasta de dados invalida.");
        }
        this.maxBytes = options.maxBytes || 1024 * 1024;
        this.folder = path.join(userDataPath, "diagnostics");
        this.filePath = path.join(this.folder, "incidents.ndjson");
        this.previousPath = this.filePath + ".previous";
        fs.mkdirSync(this.folder, { recursive: true });
        this.history = [
            ...this.readTail(this.previousPath),
            ...this.readTail(this.filePath)
        ].slice(-100);
        this.sealInterruptedLastLine();
    }

    sealInterruptedLastLine() {
        if (!fs.existsSync(this.filePath)) return;
        const size = fs.statSync(this.filePath).size;
        if (!size) return;
        const fd = fs.openSync(this.filePath, "r");
        const tail = Buffer.alloc(1);
        try {
            fs.readSync(fd, tail, 0, 1, size - 1);
        } finally {
            fs.closeSync(fd);
        }
        if (tail[0] !== 10) {
            // Recover valid future append operations after a torn JSON line.
            fs.appendFileSync(this.filePath, "\n", "utf8");
        }
    }

    readTail(file) {
        if (!fs.existsSync(file)) return [];
        const stat = fs.statSync(file);
        const start = Math.max(0, stat.size - this.maxBytes);
        const bytes = Math.max(0, stat.size - start);
        if (!bytes) return [];
        const fd = fs.openSync(file, "r");
        let buffer;
        try {
            buffer = Buffer.alloc(bytes);
            fs.readSync(fd, buffer, 0, bytes, start);
        } finally {
            fs.closeSync(fd);
        }
        let text = buffer.toString("utf8");
        if (start > 0) {
            const firstNewline = text.indexOf("\n");
            if (firstNewline === -1) return [];
            text = text.slice(firstNewline + 1);
        }
        const rows = [];
        for (const line of text.split("\n")) {
            if (!line.trim()) continue;
            try {
                const entry = JSON.parse(line);
                if (entry && typeof entry.at === "string" &&
                    typeof entry.type === "string" &&
                    typeof entry.detail === "string" &&
                    typeof entry.mediaName === "string") {
                    rows.push(entry);
                }
            } catch {
                // Partial writes should not erase previous, valid events.
            }
        }
        return rows.slice(-100);
    }

    append(raw) {
        const entry = {
            at: String(raw.at).slice(0, 32),
            type: /^[A-Z_]{3,40}$/.test(raw.type) ? raw.type : "DIAGNOSTICO",
            detail: String(raw.detail || "").slice(0, 300),
            mediaName: String(raw.mediaName || "").slice(0, 160)
        };
        const line = JSON.stringify(entry) + "\n";
        const lineBytes = Buffer.byteLength(line, "utf8");
        const size = fs.existsSync(this.filePath)
            ? fs.statSync(this.filePath).size : 0;
        if (size + lineBytes > this.maxBytes) {
            // Retain one previous segment; never write an unbounded journal.
            if (fs.existsSync(this.previousPath)) fs.rmSync(this.previousPath);
            if (fs.existsSync(this.filePath)) fs.renameSync(this.filePath, this.previousPath);
        }
        fs.appendFileSync(this.filePath, line, { encoding: "utf8", mode: 0o600 });
        this.history.push(entry);
        if (this.history.length > 100) this.history.shift();
        return entry;
    }

    recent(limit = 10) {
        return this.history.slice(-Math.min(100, Math.max(0, limit))).reverse();
    }
}

module.exports = { IncidentJournal };
