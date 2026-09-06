const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const ffmpegStatic = require("ffmpeg-static");

const profiles = {
    smoke: {
        cycles: 6,
        sourceDuration: 4,
        playbackSeconds: 2,
        bitrate: "8M"
    },
    quick: {
        cycles: 30,
        sourceDuration: 10,
        playbackSeconds: 4,
        bitrate: "16M"
    },
    day: {
        cycles: 1440,
        sourceDuration: 20,
        playbackSeconds: 5,
        bitrate: "24M"
    },
    "72h": {
        cycles: 4320,
        sourceDuration: 20,
        playbackSeconds: 5,
        bitrate: "24M"
    },
    large: {
        cycles: 500,
        sourceDuration: 600,
        playbackSeconds: 8,
        bitrate: "35M"
    }
};

const profileName = process.argv[2] || "smoke";
const profile = profiles[profileName];

if (!profile) {
    console.error(
        `Perfil inválido: ${profileName}. Use smoke, quick, day, 72h ou large.`
    );
    process.exit(2);
}

if (!ffmpegStatic || !fs.existsSync(ffmpegStatic)) {
    console.error("FFmpeg do ffmpeg-static não foi encontrado.");
    process.exit(2);
}

const startedAt = new Date();
const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "santtos-tv-stress-")
);
const mediaRoot = path.join(tempRoot, "media");
const reportPath = path.join(
    process.cwd(),
    `stress-report-${profileName}.json`
);

fs.mkdirSync(mediaRoot, { recursive: true });

const sources = [
    {
        name: "fullhd-2997.mp4",
        size: "1920x1080",
        fps: "30000/1001"
    },
    {
        name: "four-three-2997.mp4",
        size: "1440x1080",
        fps: "30000/1001"
    },
    {
        name: "fullhd-5994.mp4",
        size: "1920x1080",
        fps: "60000/1001"
    }
];

const hashtagStyles = [
    {
        text: "#RondaPopular",
        fontSize: 28,
        x: 55,
        y: 32,
        opacity: 0.68,
        outline: 1
    },
    {
        text: "#PortoAlegre24Horas",
        fontSize: 24,
        x: 42,
        y: 28,
        opacity: 0.75,
        outline: 0
    },
    {
        text: "",
        fontSize: 28,
        x: 55,
        y: 32,
        opacity: 0.68,
        outline: 1
    }
];

const report = {
    profile: profileName,
    startedAt: startedAt.toISOString(),
    tempRoot,
    environment: {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        cpuCount: os.cpus().length,
        totalMemoryBytes: os.totalmem(),
        freeMemoryBytesAtStart: os.freemem()
    },
    generatedMedia: [],
    cyclesRequested: profile.cycles,
    cyclesCompleted: 0,
    failures: [],
    timingsMs: [],
    maxNodeRssBytes: process.memoryUsage().rss,
    minFreeSystemMemoryBytes: os.freemem()
};

function run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            windowsHide: true,
            stdio: ["ignore", "ignore", "pipe"],
            ...options
        });

        let stderr = "";
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
            if (stderr.length > 16000) {
                stderr = stderr.slice(-16000);
            }
        });

        child.once("error", reject);
        child.once("exit", (code, signal) => {
            if (code === 0) {
                resolve({ code, signal, stderr });
                return;
            }

            const error = new Error(
                `Processo encerrou com código ${code}, sinal ${signal || "-"}. ${stderr}`
            );
            error.code = code;
            reject(error);
        });
    });
}

function escapeFilterText(value) {
    return String(value)
        .replaceAll("\\", "\\\\")
        .replaceAll(":", "\\:")
        .replaceAll("'", "\\'")
        .replaceAll("%", "\\%")
        .replaceAll(",", "\\,")
        .replaceAll("[", "\\[")
        .replaceAll("]", "\\]");
}

function getFontPath() {
    if (process.platform === "win32") {
        const windir = process.env.WINDIR || "C:\\Windows";
        return path.join(windir, "Fonts", "arial.ttf");
    }

    const candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf"
    ];

    return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function buildFilter(style) {
    const filters = [
        "scale=1920:1080:force_original_aspect_ratio=decrease",
        "pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black",
        "setsar=1",
        "fps=30000/1001"
    ];

    if (!style.text) {
        return filters.join(",");
    }

    const fontPath = getFontPath();
    const escapedFont = fontPath
        .replaceAll("\\", "/")
        .replace(":", "\\:");

    filters.push(
        [
            "drawtext=",
            escapedFont ? `fontfile='${escapedFont}':` : "",
            `text='${escapeFilterText(style.text)}':`,
            `x=${style.x}:y=${style.y}:`,
            `fontsize=${style.fontSize}:`,
            `fontcolor=white@${style.opacity}:`,
            `borderw=${style.outline}:bordercolor=black@0.35`
        ].join("")
    );

    return filters.join(",");
}

async function generateSources() {
    console.log(`\n[stress] Gerando ${sources.length} arquivos sintéticos...`);

    if (profileName === "large") {
        console.log(
            "[stress] Perfil large: serão gerados arquivos de vários GB. Verifique espaço livre em disco."
        );
    }

    for (const source of sources) {
        const output = path.join(mediaRoot, source.name);
        const before = Date.now();

        await run(ffmpegStatic, [
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            `testsrc2=size=${source.size}:rate=${source.fps}`,
            "-t",
            String(profile.sourceDuration),
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-b:v",
            profile.bitrate,
            "-maxrate",
            profile.bitrate,
            "-bufsize",
            "70M",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-y",
            output
        ]);

        const stat = fs.statSync(output);
        report.generatedMedia.push({
            ...source,
            path: output,
            bytes: stat.size,
            generationMs: Date.now() - before
        });

        console.log(
            `[stress] ${source.name}: ${(stat.size / 1024 / 1024 / 1024).toFixed(2)} GB`
        );
    }
}

async function runCycle(index) {
    const source = sources[index % sources.length];
    const style = hashtagStyles[index % hashtagStyles.length];
    const input = path.join(mediaRoot, source.name);
    const seekWindow = Math.max(
        0,
        profile.sourceDuration - profile.playbackSeconds
    );
    const seek = seekWindow > 0
        ? (index * 17.731) % seekWindow
        : 0;

    const before = Date.now();

    await run(ffmpegStatic, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        seek.toFixed(3),
        "-i",
        input,
        "-t",
        String(profile.playbackSeconds),
        "-map",
        "0:v:0",
        "-an",
        "-sn",
        "-dn",
        "-vf",
        buildFilter(style),
        "-pix_fmt",
        "bgra",
        "-f",
        "rawvideo",
        process.platform === "win32" ? "NUL" : "/dev/null"
    ]);

    report.timingsMs.push(Date.now() - before);
    report.cyclesCompleted += 1;
    report.maxNodeRssBytes = Math.max(
        report.maxNodeRssBytes,
        process.memoryUsage().rss
    );
    report.minFreeSystemMemoryBytes = Math.min(
        report.minFreeSystemMemoryBytes,
        os.freemem()
    );
}

function saveReport() {
    const timings = report.timingsMs;
    report.finishedAt = new Date().toISOString();
    report.elapsedMs = Date.now() - startedAt.getTime();
    report.averageCycleMs = timings.length
        ? timings.reduce((sum, value) => sum + value, 0) / timings.length
        : 0;
    report.maxCycleMs = timings.length
        ? Math.max(...timings)
        : 0;
    report.freeSystemMemoryBytesAtEnd = os.freemem();
    report.success = report.failures.length === 0 &&
        report.cyclesCompleted === report.cyclesRequested;

    fs.writeFileSync(
        reportPath,
        JSON.stringify(report, null, 2),
        "utf8"
    );
}

(async () => {
    console.log(
        `[stress] Perfil=${profileName} | ciclos=${profile.cycles} | reprodução/ciclo=${profile.playbackSeconds}s`
    );
    console.log(
        "[stress] Cada ciclo força scale/pad/SAR/fps/drawtext/BGRA como o PROGRAM."
    );

    try {
        await generateSources();

        for (let index = 0; index < profile.cycles; index += 1) {
            try {
                await runCycle(index);
            } catch (error) {
                report.failures.push({
                    cycle: index + 1,
                    message: error.message
                });
                console.error(
                    `\n[stress] FALHA no ciclo ${index + 1}: ${error.message}`
                );
                break;
            }

            const completed = index + 1;
            if (
                completed === 1 ||
                completed % Math.max(1, Math.floor(profile.cycles / 20)) === 0 ||
                completed === profile.cycles
            ) {
                console.log(
                    `[stress] ${completed}/${profile.cycles} ciclos | RSS Node ${(process.memoryUsage().rss / 1024 / 1024).toFixed(1)} MB | RAM livre ${(os.freemem() / 1024 / 1024 / 1024).toFixed(1)} GB`
                );
            }
        }
    } catch (error) {
        report.failures.push({
            cycle: 0,
            message: error.message
        });
        console.error(`[stress] FALHA: ${error.message}`);
    } finally {
        saveReport();
        fs.rmSync(tempRoot, {
            recursive: true,
            force: true
        });
    }

    console.log(`\n[stress] Relatório: ${reportPath}`);
    console.log(
        `[stress] Resultado: ${report.success ? "APROVADO" : "REPROVADO"}`
    );

    process.exit(report.success ? 0 : 1);
})();
