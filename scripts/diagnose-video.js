"use strict";
// Read-only local diagnostic. No media upload, repair, database mutation or QC bypass.
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const runFile = promisify(execFile);
const { resolveMediaRuntime } = require("../src/core/media/runtime-paths");

function redact(text, file) {
    let result = String(text).split(file).join("[arquivo]").split(path.dirname(file)).join("[pasta]");
    return result.replace(/0x[0-9a-f]+|@\s*[0-9a-f]{12,}/gi, "[endereço]").slice(0, 1000);
}

async function decode(ffmpeg, file, videoIndex, duration, strict) {
    const args = ["-hide_banner", "-nostdin", "-nostats", "-loglevel", strict ? "error" : "warning"];
    if (strict) args.push("-xerror", "-err_detect", "explode");
    args.push("-threads", "1", "-filter_threads", "1", "-filter_complex_threads", "1", "-i", file,
        "-map", `0:${videoIndex}`, "-map", "0:a?", "-sn", "-dn", "-threads", "1",
        "-stats_period", "0.5", "-progress", "pipe:1", "-f", "null", "-");
    return new Promise((resolve, reject) => {
        const child = spawn(ffmpeg, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
        let frames = 0, lastMediaSeconds = null, progressEnd = false, lastActivity = Date.now();
        let stdout = "", stderr = "", logLines = 0, timedOut = null, killer;
        const messages = [], started = Date.now();
        const log = line => {
            if (!line.trim()) return;
            logLines++;
            if (messages.length < 300) messages.push({ nearLastProgressSeconds: lastMediaSeconds, text: redact(line, file) });
        };
        const stop = reason => {
            if (timedOut) return; timedOut = reason; child.kill();
            killer = setTimeout(() => child.kill("SIGKILL"), 2000); killer.unref();
        };
        const watchdog = setInterval(() => { if (Date.now() - lastActivity > 60000) stop("Sem progresso de decodificação por 60 segundos."); }, 1000);
        const deadline = setTimeout(() => stop("Prazo total excedido."), Math.max(600000, Math.min(86400000, (duration * 3 + 120) * 1000)));
        child.stdout.on("data", chunk => {
            lastActivity = Date.now(); stdout += chunk.toString(); const lines = stdout.split(/\r?\n/); stdout = lines.pop().slice(-65536);
            for (const line of lines) {
                if (line.startsWith("frame=")) frames = Math.max(frames, Number(line.slice(6)) || 0);
                if (line.startsWith("out_time_us=")) { const value = Number(line.slice(12)); if (Number.isFinite(value)) lastMediaSeconds = value / 1000000; }
                if (line === "progress=end") progressEnd = true;
            }
        });
        child.stderr.on("data", chunk => { stderr += chunk.toString(); const lines = stderr.split(/\r?\n/); stderr = lines.pop().slice(-65536); lines.forEach(log); });
        const cleanup = () => { clearInterval(watchdog); clearTimeout(deadline); clearTimeout(killer); };
        child.once("error", error => { cleanup(); reject(error); });
        child.once("close", (exitCode, signal) => {
            cleanup(); if (stderr) log(stderr);
            resolve({ mode: strict ? "strict-current-validator" : "default-decoder-without-stop-on-first-error",
                exitCode, signal, timedOut, frames, lastMediaSeconds, progressEnd,
                elapsedSeconds: (Date.now() - started) / 1000, logLines, messages,
                omittedLogLines: Math.max(0, logLines - messages.length) });
        });
    });
}

async function diagnose(file, outputFolder = path.resolve("diagnosticos")) {
    file = await fs.promises.realpath(file);
    const before = await fs.promises.stat(file);
    if (!before.isFile()) throw Error("Escolha um arquivo de vídeo, não uma pasta.");
    const ffmpeg = resolveMediaRuntime("ffmpeg"), ffprobe = resolveMediaRuntime("ffprobe");
    const version = (await runFile(ffmpeg, ["-version"], { windowsHide: true, timeout: 10000 })).stdout.split(/\r?\n/)[0];
    const { stdout } = await runFile(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
        { windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
    const probe = JSON.parse(stdout);
    const video = (probe.streams || []).find(stream => stream.codec_type === "video" && !stream.disposition?.attached_pic);
    if (!video) throw Error("Nenhuma faixa de vídeo foi encontrada.");
    const duration = Number(probe.format?.duration || video.duration) || 300;
    console.log("1/2 — Verificação estrita (mesmo critério de parada do Santtos)…");
    const strict = await decode(ffmpeg, file, video.index, duration, true);
    console.log("2/2 — Decodificação completa, sem parar no primeiro erro. Aguarde…");
    const tolerant = await decode(ffmpeg, file, video.index, duration, false);
    const after = await fs.promises.stat(file);
    const report = { format: "santtos-video-diagnostic", version: 1, createdAt: new Date().toISOString(),
        file: { name: path.basename(file), bytes: before.size, modifiedAt: before.mtime.toISOString(),
            unchangedDuringTest: before.size === after.size && before.mtimeMs === after.mtimeMs && before.ino === after.ino },
        runtime: { ffmpeg: version, platform: process.platform, arch: process.arch },
        media: { durationSeconds: Number(probe.format?.duration) || null,
            streams: (probe.streams || []).map(stream => ({ index: stream.index, type: stream.codec_type,
                codec: stream.codec_name, profile: stream.profile, width: stream.width, height: stream.height,
                pixelFormat: stream.pix_fmt, frameRate: stream.avg_frame_rate, expectedFrames: stream.nb_frames,
                duration: stream.duration, sampleRate: stream.sample_rate, channels: stream.channels })) },
        strict, tolerant,
        interpretation: "Diagnóstico apenas; não aprova material nem mede sincronismo. Mensagens são amostras limitadas; nearLastProgressSeconds é aproximação pelo último progresso recebido, não o timestamp exato do pacote. logLines não representa quantidade de quadros danificados. progressEnd e exitCode devem ser avaliados juntos." };
    await fs.promises.mkdir(outputFolder, { recursive: true });
    const destination = path.join(outputFolder, `diagnostico-video-${Date.now()}.json`);
    await fs.promises.writeFile(destination, JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(`Relatório criado: ${destination}`);
    console.log(`Estrito: código ${strict.exitCode}, ${strict.frames} quadros. Completo: código ${tolerant.exitCode}, ${tolerant.frames} quadros.`);
    return { destination, report };
}
if (require.main === module) {
    const file = process.argv[2];
    if (!file) { console.error('Uso: npm run diagnostico:video -- "C:\\Videos\\episodio.mp4"'); process.exitCode = 1; }
    else diagnose(file).catch(error => { console.error("Diagnóstico não concluído:", redact(error.message, path.resolve(file))); process.exitCode = 1; });
}
module.exports = { diagnose };
