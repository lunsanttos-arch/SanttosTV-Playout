"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function filterPath(value) {
    return String(value).replaceAll("\\", "/").replaceAll(":", "\\:").replaceAll("'", "\\\\\\'");
}
class LiveGraphics {
    constructor({ hashtag = "", logoPath = "", logoPng = null, blankPng }) {
        this.folder = fs.mkdtempSync(path.join(os.tmpdir(), "santtos-gc-"));
        this.logoFile = path.join(this.folder, "logo.png");
        this.hashtag = hashtag;
        fs.writeFileSync(this.logoFile, logoPng || (logoPath ? fs.readFileSync(logoPath) : blankPng));
        this.inFlight = false; this.ackTimer = null;
        this.errors = 0; this.commands = 0; this.reply = "";
        this.child = null; this.closed = false; this.timer = null; this.pending = new Map();
    }
    attach(child) { this.child = child; child.stdin.on("error", () => {}); this.text(this.hashtag);
        this.onReply = chunk => {
            this.reply = (this.reply + chunk.toString()).slice(-2000);
            const lines = this.reply.split(/\r?\n/); this.reply = lines.pop();
            // FFmpeg also replies ret:-38 for audio graphs without the video target.
            // Only the PROGRAM video graph (stream 0) acknowledges our command.
            for (const line of lines) {
                if (/Command reply for stream 0: ret:-|Parse error/.test(line)) this.errors++;
                if (/Command reply for stream 0:|Parse error/.test(line)) {
                    this.inFlight = false; clearTimeout(this.ackTimer); this.flush();
                }
            }
        };
        child.stderr.on("data", this.onReply); return this; }
    command(target, command, argument) {
        if (this.closed || !this.child || this.child.stdin.destroyed) return;
        if (!/^[a-zA-Z0-9_@]+$/.test(target) || !/^[a-zA-Z0-9_]+$/.test(command) || /[\r\n\0]/.test(argument) || Buffer.byteLength(argument) > 250)
            throw new Error("Comando gráfico inválido.");
        this.pending.set(`${target}:${command}:${command === "reinit" ? argument.split("=")[0] : ""}`, `c${target} -1 ${command} ${argument}\n`);
        if (!this.timer) this.timer = setTimeout(() => this.flush(), 30);
    }
    flush() {
        this.timer = null;
        if (this.closed || !this.child || this.child.stdin.destroyed || this.inFlight) return;
        const entry = this.pending.entries().next().value;
        if (!entry) return;
        this.pending.delete(entry[0]); this.inFlight = true; this.commands++;
        this.child.stdin.write(entry[1]);
        this.ackTimer = setTimeout(() => {
            if (this.closed) return;
            this.inFlight = false; this.errors++; this.flush();
        }, 3000);
    }
    text(value) {
        if (this.closed) return;
        let safe = String(value || " ").replace(/[\r\n\0]/g, " ");
        while (Buffer.byteLength(safe) > 240) safe = Array.from(safe).slice(0, -1).join("");
        this.command("drawtext@program_hashtag", "text", safe);
    }
    image(buffer) {
        if (this.closed) return;
        fs.writeFileSync(this.logoFile + ".next", buffer);
        fs.renameSync(this.logoFile + ".next", this.logoFile);
    }
    snapshot() { return { commands: this.commands, errors: this.errors, pending: this.pending.size }; }
    logo(enabled) { this.command("overlay@program_logo", "enable", enabled ? "1" : "0"); }
    style(options, target = "drawtext@program_hashtag") {
        let group = "";
        for (const [key, value] of Object.entries(options)) {
            const option = `${key}=${value}`;
            if (group && Buffer.byteLength(`${group}:${option}`) > 240) {
                this.command(target, "reinit", group);
                group = "";
            }
            group = group ? `${group}:${option}` : option;
        }
        if (group) this.command(target, "reinit", group);
    }
    stop() {
        if (this.closed) return;
        this.closed = true; clearTimeout(this.ackTimer); clearTimeout(this.timer); this.pending.clear();
        if (this.onReply) this.child?.stderr.off("data", this.onReply);
        const cleanup = () => fs.rm(this.folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }, () => {});
        if (this.child && this.child.exitCode === null && this.child.signalCode === null) this.child.once("close", cleanup);
        else cleanup();
    }
}
module.exports = { LiveGraphics, filterPath };
