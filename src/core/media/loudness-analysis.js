"use strict";
const { spawn } = require("node:child_process");
const os = require("node:os");
const { parseLoudness } = require("../audio/loudness");

function analyzeLoudness({ ffmpeg, file, audioStreamIndex, duration, channels = 2, onChild, isCanceled = () => false }) {
    if (audioStreamIndex === null) return Promise.resolve({ version: 1, status: "no-audio" });
    return new Promise((resolve, reject) => {
        if (isCanceled()) return reject(Error("Análise cancelada."));
        const child = spawn(ffmpeg, ["-hide_banner", "-nostdin", "-nostats", "-threads", "1", "-filter_threads", "1",
            "-i", file, "-map", Number.isSafeInteger(audioStreamIndex) ? `0:${audioStreamIndex}` : "0:a:0?",
            "-vn", "-sn", "-dn", "-ac", String(channels), "-af", `aformat=channel_layouts=${channels === 1 ? "mono" : "stereo"},loudnorm=I=-23:TP=-1:LRA=7:print_format=json`,
            "-progress", "pipe:1", "-f", "null", "-"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        onChild?.(child);
        try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
        let stderr = "", lastProgress = Date.now(), finished = false;
        child.stdout.on("data", () => { lastProgress = Date.now(); });
        child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-12000); });
        const timer = setInterval(() => { if (Date.now() - lastProgress > 60000) fail(Error("Medição de áudio sem progresso.")); }, 1000);
        const deadline = setTimeout(() => fail(Error("Medição de áudio excedeu o prazo.")), Math.max(60000, Math.min(86400000, ((duration || 300) * 3 + 120) * 1000)));
        function cleanup() { clearInterval(timer); clearTimeout(deadline); }
        function fail(error) {
            if (finished) return; finished = true; cleanup(); child.kill();
            const kill = setTimeout(() => child.kill("SIGKILL"), 1000); kill.unref(); child.once("close", () => clearTimeout(kill));
            reject(error);
        }
        child.once("error", fail);
        child.once("close", (code, signal) => {
            if (finished) return; finished = true; cleanup();
            if (isCanceled() || code !== 0 || signal) return reject(Error("Não foi possível medir o áudio: " + stderr.slice(-1000)));
            try { resolve(parseLoudness(stderr)); } catch (error) { reject(error); }
        });
    });
}
module.exports = { analyzeLoudness };
