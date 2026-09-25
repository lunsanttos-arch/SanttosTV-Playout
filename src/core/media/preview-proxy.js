"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const ffmpegStatic = require("ffmpeg-static");

const activeConversions = new Map();
const PROXY_LIMIT = 2 * 1024 * 1024 * 1024; // 2 GiB por proxy de preview

/**
 * Cria uma copia leve apenas para o monitor Chromium. A midia original
 * continua sendo utilizada pelo engine FFmpeg / NDI no PROGRAM.
 */
async function preparePreviewProxy(sourcePath, cacheFolder, options = {}) {
    const realSourcePath = fs.realpathSync(sourcePath);
    const stat = fs.statSync(realSourcePath);
    if (!stat.isFile() || stat.size < 1) throw new Error("Arquivo de origem indisponivel.");
    if (typeof cacheFolder !== "string" || !path.isAbsolute(cacheFolder)) {
        throw new Error("Pasta de cache invalida.");
    }

    fs.mkdirSync(cacheFolder, { recursive: true });
    const key = crypto.createHash("sha256")
        .update(JSON.stringify([
            realSourcePath, stat.size, stat.mtimeMs, "browser-preview-v1"
        ]))
        .digest("hex");
    const output = path.join(cacheFolder, `preview-${key}.mp4`);
    if (fs.existsSync(output) && fs.statSync(output).size > 0) return output;
    if (activeConversions.has(key)) return activeConversions.get(key);

    if (activeConversions.size > 0) {
        throw new Error("Ja existe uma previa sendo preparada. Aguarde a conclusao.");
    }

    const ffmpegPath = options.ffmpegPath ||
        (typeof ffmpegStatic === "string"
            ? ffmpegStatic.replace("app.asar", "app.asar.unpacked")
            : null);
    if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
        throw new Error("FFmpeg nao encontrado para preparar a previa.");
    }

    const pending = (async () => {
        const tempFile = path.join(cacheFolder, `preview-${key}.${process.pid}.tmp.mp4`);
        const args = [
            "-hide_banner", "-loglevel", "warning", "-nostdin",
            "-i", realSourcePath,
            "-map", "0:v:0", "-map", "0:a:0?",
            "-vf", "scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2:black,fps=30000/1001",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30",
            "-pix_fmt", "yuv420p", "-threads", "2",
            "-c:a", "aac", "-b:a", "96k",
            "-movflags", "+faststart", "-f", "mp4",
            "-y", tempFile
        ];
        try {
            await new Promise((resolve, reject) => {
                const child = spawn(ffmpegPath, args, {
                    stdio: ["ignore", "ignore", "pipe"],
                    windowsHide: true
                });
                let stderr = "";
                let finished = false;
                const checkSize = setInterval(() => {
                    try {
                        if (fs.existsSync(tempFile) && fs.statSync(tempFile).size > PROXY_LIMIT) {
                            child.kill();
                        }
                    } catch { /* arquivo ainda nao criado */ }
                }, 2000);
                const done = (error) => {
                    if (finished) return;
                    finished = true;
                    clearInterval(checkSize);
                    error ? reject(error) : resolve();
                };
                child.stderr.on("data", (chunk) => {
                    stderr = (stderr + chunk.toString()).slice(-8192);
                });
                child.on("error", (error) => done(error));
                child.on("exit", (code) => {
                    if (code === 0) done();
                    else done(new Error(
                        `A conversao da previa falhou (FFmpeg ${code}): ${stderr.slice(-700)}`
                    ));
                });
            });
            if (!fs.existsSync(tempFile) || fs.statSync(tempFile).size < 1) {
                throw new Error("O FFmpeg nao produziu uma previa valida.");
            }
            fs.renameSync(tempFile, output);
            return output;
        } finally {
            if (fs.existsSync(tempFile)) fs.rmSync(tempFile, { force: true });
        }
    })();

    activeConversions.set(key, pending);
    try {
        return await pending;
    } finally {
        activeConversions.delete(key);
    }
}

module.exports = { preparePreviewProxy };
