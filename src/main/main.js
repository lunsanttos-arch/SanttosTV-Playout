const {
    app,
    BrowserWindow,
    ipcMain,
    dialog
} = require("electron");

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const ffmpegStatic = require("ffmpeg-static");

const {
    initializeDatabase,
    getSettings,
    updateHashtagStyle,
    addLog,
    getMedia,
    getTimeline,
    saveTimeline,
    addMedia,
    removeMedia,
    updateMediaMetadata
} = require(
    "../database/database"
);

const {
    probeMedia
} = require(
    "../core/media/ffprobe"
);

const isDevelopment = !app.isPackaged;

const NDI_FRAME_WIDTH = 1920;
const NDI_FRAME_HEIGHT = 1080;
const NDI_BYTES_PER_PIXEL = 4;
const NDI_FRAME_SIZE =
    NDI_FRAME_WIDTH *
    NDI_FRAME_HEIGHT *
    NDI_BYTES_PER_PIXEL;

const FONT_FILES = {
    "Arial": {
        regular: "arial.ttf",
        bold: "arialbd.ttf"
    },
    "Segoe UI": {
        regular: "segoeui.ttf",
        bold: "segoeuib.ttf"
    },
    "Tahoma": {
        regular: "tahoma.ttf",
        bold: "tahomabd.ttf"
    },
    "Verdana": {
        regular: "verdana.ttf",
        bold: "verdanab.ttf"
    },
    "Calibri": {
        regular: "calibri.ttf",
        bold: "calibrib.ttf"
    }
};

let mainWindow = null;
let ndiProcess = null;
let ffmpegProcess = null;

let ndiReady = false;
let ndiFrameBusy = false;
let nativePlaybackActive = false;

const analysesInProgress = new Map();

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1500,
        height: 900,
        minWidth: 1100,
        minHeight: 700,
        backgroundColor: "#0b0b0b",
        title: "Santtos TV Automation",
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false,
            preload: path.join(
                __dirname,
                "preload.js"
            )
        }
    });

    mainWindow.maximize();

    if (isDevelopment) {
        mainWindow.loadURL(
            "http://localhost:5173"
        );
    } else {
        mainWindow.loadFile(
            path.join(
                __dirname,
                "../../dist/index.html"
            )
        );
    }

    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

async function analyzeMediaItem(mediaItem) {
    const existingAnalysis =
        analysesInProgress.get(mediaItem.id);

    if (existingAnalysis) {
        return existingAnalysis;
    }

    const analysisPromise = (async () => {
        updateMediaMetadata(
            mediaItem.id,
            {
                status: "analyzing",
                metadataError: null,
                analysisStartedAt:
                    new Date().toISOString()
            }
        );

        try {
            const metadata =
                await probeMedia(mediaItem.path);

            updateMediaMetadata(
                mediaItem.id,
                {
                    ...metadata,
                    analysisCompletedAt:
                        new Date().toISOString()
                }
            );

            console.log(
                [
                    "FFprobe OK:",
                    mediaItem.name,
                    `${metadata.width}x${metadata.height}`,
                    metadata.videoCodec,
                    `${metadata.fps} fps`,
                    `${metadata.duration} s`
                ].join(" | ")
            );
        } catch (error) {
            console.error(
                `FFprobe falhou em ${mediaItem.name}:`,
                error
            );

            updateMediaMetadata(
                mediaItem.id,
                {
                    status: "error",
                    metadataError:
                        error.message,
                    analysisCompletedAt:
                        new Date().toISOString()
                }
            );
        } finally {
            analysesInProgress.delete(
                mediaItem.id
            );
        }
    })();

    analysesInProgress.set(
        mediaItem.id,
        analysisPromise
    );

    return analysisPromise;
}

async function analyzeMediaItems(mediaItems) {
    await Promise.all(
        mediaItems.map(analyzeMediaItem)
    );

    return getMedia();
}

function resolveFfmpegPath() {
    if (!ffmpegStatic) {
        throw new Error(
            "FFmpeg runtime não encontrado."
        );
    }

    const resolvedPath = app.isPackaged
        ? ffmpegStatic.replace(
              "app.asar",
              "app.asar.unpacked"
          )
        : ffmpegStatic;

    if (!fs.existsSync(resolvedPath)) {
        throw new Error(
            `FFmpeg não encontrado em ${resolvedPath}`
        );
    }

    return resolvedPath;
}

function escapeDrawtextText(value) {
    return String(value ?? "")
        .replaceAll("\\", "\\\\")
        .replaceAll(":", "\\:")
        .replaceAll("'", "\\'")
        .replaceAll("%", "\\%")
        .replaceAll(",", "\\,")
        .replaceAll("[", "\\[")
        .replaceAll("]", "\\]");
}

function toFfmpegColor(hexColor, opacity) {
    const normalizedHex =
        typeof hexColor === "string"
            ? hexColor.replace("#", "")
            : "ffffff";

    const normalizedOpacity = Math.min(
        1,
        Math.max(0, Number(opacity) || 0)
    );

    return `0x${normalizedHex}@${normalizedOpacity.toFixed(3)}`;
}

function resolveHashtagFont(style) {
    const family =
        FONT_FILES[style.fontFamily] ??
        FONT_FILES.Arial;

    const fileName = style.bold
        ? family.bold
        : family.regular;

    const windowsFolder =
        process.env.WINDIR ||
        "C:\\Windows";

    const candidate = path.join(
        windowsFolder,
        "Fonts",
        fileName
    );

    const fallback = path.join(
        windowsFolder,
        "Fonts",
        style.bold
            ? "arialbd.ttf"
            : "arial.ttf"
    );

    return (fs.existsSync(candidate)
        ? candidate
        : fallback
    )
        .replaceAll("\\", "/")
        .replace(":", "\\:");
}

function buildVideoFilter(hashtag) {
    // O asset é normalizado primeiro para o PROGRAM 1920x1080.
    // O GC é aplicado somente depois, portanto sua geometria é
    // sempre relativa ao output final e nunca ao arquivo de origem.
    const filters = [
        "scale=1920:1080:force_original_aspect_ratio=decrease",
        "pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black",
        "setsar=1",
        "fps=30000/1001"
    ];

    const normalizedHashtag =
        typeof hashtag === "string"
            ? hashtag.trim()
            : "";

    if (!normalizedHashtag) {
        return filters.join(",");
    }

    const style =
        getSettings().hashtagStyle;

    const options = [
        `fontfile='${resolveHashtagFont(style)}'`,
        `text='${escapeDrawtextText(normalizedHashtag)}'`,
        `x=${Math.round(style.x)}`,
        `y=${Math.round(style.y)}`,
        `fontsize=${Math.round(style.fontSize)}`,
        `fontcolor=${toFfmpegColor(style.color, style.opacity)}`,
        `borderw=${Math.round(style.outlineWidth)}`,
        `bordercolor=${toFfmpegColor(style.outlineColor, style.outlineOpacity)}`
    ];

    if (style.shadowEnabled) {
        options.push(
            `shadowcolor=${toFfmpegColor(style.shadowColor, style.shadowOpacity)}`,
            `shadowx=${Math.round(style.shadowX)}`,
            `shadowy=${Math.round(style.shadowY)}`
        );
    }

    filters.push(
        `drawtext=${options.join(":")}`
    );

    return filters.join(",");
}

function stopNativePlayback() {
    if (!ffmpegProcess) {
        nativePlaybackActive = false;
        return;
    }

    const processToStop = ffmpegProcess;

    console.log(
        "Encerrando playout FFmpeg..."
    );

    if (
        processToStop.stdout &&
        ndiProcess &&
        ndiProcess.stdin
    ) {
        processToStop.stdout.unpipe(
            ndiProcess.stdin
        );
    }

    ffmpegProcess = null;
    nativePlaybackActive = false;

    if (!processToStop.killed) {
        processToStop.kill();
    }
}

function startNativePlayback(
    filePath,
    startSeconds = 0,
    hashtag = ""
) {
    if (
        typeof filePath !== "string" ||
        filePath.length === 0
    ) {
        throw new Error(
            "Arquivo de playout inválido."
        );
    }

    if (!fs.existsSync(filePath)) {
        throw new Error(
            `Arquivo não encontrado: ${filePath}`
        );
    }

    const normalizedStartSeconds =
        Number.isFinite(Number(startSeconds))
            ? Math.max(
                  0,
                  Number(startSeconds)
              )
            : 0;

    if (
        !ndiReady ||
        !ndiProcess ||
        !ndiProcess.stdin ||
        ndiProcess.stdin.destroyed
    ) {
        throw new Error(
            "Engine NDI ainda não está pronto."
        );
    }

    stopNativePlayback();

    const ffmpegPath = resolveFfmpegPath();
    const videoFilter =
        buildVideoFilter(hashtag);

    const args = [
        "-hide_banner",
        "-loglevel",
        "warning",
        "-nostdin"
    ];

    if (normalizedStartSeconds > 0) {
        args.push(
            "-ss",
            normalizedStartSeconds.toFixed(3)
        );
    }

    args.push(
        "-i",
        filePath,
        "-map",
        "0:v:0",
        "-an",
        "-sn",
        "-dn",
        "-vf",
        videoFilter,
        "-pix_fmt",
        "bgra",
        "-f",
        "rawvideo",
        "pipe:1"
    );

    console.log(
        `Iniciando playout FFmpeg: ${path.basename(filePath)} @ ${normalizedStartSeconds.toFixed(3)}s${hashtag ? ` | ${hashtag}` : ""}`
    );

    const processRef = spawn(
        ffmpegPath,
        args,
        {
            windowsHide: true,
            stdio: [
                "ignore",
                "pipe",
                "pipe"
            ]
        }
    );

    ffmpegProcess = processRef;
    nativePlaybackActive = true;
    ndiFrameBusy = false;

    processRef.stdout.pipe(
        ndiProcess.stdin,
        { end: false }
    );

    processRef.stderr.on(
        "data",
        (data) => {
            const message =
                data.toString().trim();

            if (message) {
                console.warn(
                    `[FFmpeg] ${message}`
                );
            }
        }
    );

    processRef.on(
        "error",
        (error) => {
            console.error(
                "Falha no playout FFmpeg:",
                error
            );

            if (ffmpegProcess === processRef) {
                ffmpegProcess = null;
                nativePlaybackActive = false;
            }
        }
    );

    processRef.on(
        "exit",
        (code, signal) => {
            if (
                ndiProcess &&
                ndiProcess.stdin &&
                processRef.stdout
            ) {
                processRef.stdout.unpipe(
                    ndiProcess.stdin
                );
            }

            console.log(
                `Playout FFmpeg encerrado. Código: ${code}, sinal: ${signal}`
            );

            if (ffmpegProcess === processRef) {
                ffmpegProcess = null;
                nativePlaybackActive = false;
            }
        }
    );

    return {
        ok: true,
        filePath,
        startSeconds:
            normalizedStartSeconds
    };
}

function registerIpcHandlers() {
    ipcMain.handle(
        "ndi:status",
        async () => ({
            online:
                ndiReady &&
                Boolean(ndiProcess) &&
                !ndiProcess.killed,
            source:
                "Santtos TV - PROGRAM",
            nativePlaybackActive
        })
    );

    ipcMain.handle(
        "ndi:play-file",
        async (
            _event,
            filePath,
            startSeconds = 0,
            hashtag = ""
        ) => {
            try {
                return startNativePlayback(
                    filePath,
                    startSeconds,
                    hashtag
                );
            } catch (error) {
                console.error(
                    "Não foi possível iniciar o playout nativo:",
                    error
                );

                return {
                    ok: false,
                    error: error.message
                };
            }
        }
    );

    ipcMain.handle(
        "ndi:stop-file",
        async () => {
            stopNativePlayback();
            return { ok: true };
        }
    );

    ipcMain.handle(
        "settings:get",
        async () => getSettings()
    );

    ipcMain.handle(
        "settings:set-hashtag-style",
        async (_event, style) => ({
            ok: true,
            hashtagStyle:
                updateHashtagStyle(style)
        })
    );

    ipcMain.handle(
        "timeline:list",
        async () => getTimeline()
    );

    ipcMain.handle(
        "timeline:save",
        async (_event, timelineItems) =>
            saveTimeline(timelineItems)
    );

    ipcMain.on(
        "ndi:frame",
        (_event, frameData) => {
            if (
                nativePlaybackActive ||
                !ndiProcess ||
                !ndiProcess.stdin ||
                ndiProcess.stdin.destroyed ||
                !ndiReady ||
                ndiFrameBusy
            ) {
                return;
            }

            const frameBuffer =
                Buffer.from(frameData);

            if (
                frameBuffer.length !==
                NDI_FRAME_SIZE
            ) {
                console.warn(
                    `Frame NDI ignorado: ${frameBuffer.length} bytes recebidos, ${NDI_FRAME_SIZE} esperados.`
                );
                return;
            }

            ndiFrameBusy = true;

            ndiProcess.stdin.write(
                frameBuffer,
                (error) => {
                    ndiFrameBusy = false;

                    if (error) {
                        console.error(
                            "Erro ao enviar frame para o engine NDI:",
                            error
                        );
                    }
                }
            );
        }
    );

    ipcMain.handle(
        "media:select",
        async () => {
            const result =
                await dialog.showOpenDialog({
                    title:
                        "Adicionar vídeos à biblioteca",
                    properties: [
                        "openFile",
                        "multiSelections"
                    ],
                    filters: [
                        {
                            name:
                                "Vídeos compatíveis",
                            extensions: [
                                "mp4",
                                "mov"
                            ]
                        }
                    ]
                });

            if (result.canceled) {
                return [];
            }

            return result.filePaths;
        }
    );

    ipcMain.handle(
        "media:list",
        async () => {
            const media = getMedia();

            const pendingMedia =
                media.filter(
                    (item) =>
                        item.status ===
                        "pending-metadata"
                );

            if (pendingMedia.length > 0) {
                return analyzeMediaItems(
                    pendingMedia
                );
            }

            return media;
        }
    );

    ipcMain.handle(
        "media:import",
        async (_event, filePaths) => {
            const importResult =
                addMedia(filePaths);

            const media =
                await analyzeMediaItems(
                    importResult.importedItems
                );

            return {
                ...importResult,
                media
            };
        }
    );

    ipcMain.handle(
        "media:remove",
        async (_event, mediaId) =>
            removeMedia(mediaId)
    );
}

function startNdiSender() {
    if (ndiProcess) {
        return;
    }

    ndiReady = false;
    ndiFrameBusy = false;

    const ndiExecutable = path.join(
        __dirname,
        "../core/ndi/ndi_test.exe"
    );

    console.log(
        "Iniciando sender NDI..."
    );

    try {
        ndiProcess = spawn(
            ndiExecutable,
            [],
            {
                cwd: path.dirname(
                    ndiExecutable
                ),
                windowsHide: true,
                stdio: [
                    "pipe",
                    "pipe",
                    "pipe"
                ]
            }
        );

        ndiProcess.stdin.on(
            "error",
            (error) => {
                ndiFrameBusy = false;
                console.error(
                    "Erro no stdin do engine NDI:",
                    error
                );
            }
        );

        ndiProcess.stdout.on(
            "data",
            (data) => {
                const message =
                    data.toString().trim();

                if (
                    message.includes(
                        "NDI ONLINE:"
                    )
                ) {
                    ndiReady = true;
                    console.log(
                        "Santtos NDI confirmado ONLINE"
                    );
                }

                if (message) {
                    console.log(
                        `[NDI] ${message}`
                    );
                }
            }
        );

        ndiProcess.stderr.on(
            "data",
            (data) => {
                const message =
                    data.toString().trim();

                if (message) {
                    console.error(
                        `[NDI] ${message}`
                    );
                }
            }
        );

        ndiProcess.on(
            "error",
            (error) => {
                console.error(
                    "Falha ao iniciar NDI:",
                    error
                );

                stopNativePlayback();
                ndiReady = false;
                ndiFrameBusy = false;
                ndiProcess = null;
            }
        );

        ndiProcess.on(
            "exit",
            (code, signal) => {
                console.log(
                    `Sender NDI encerrado. Código: ${code}, sinal: ${signal}`
                );

                stopNativePlayback();
                ndiReady = false;
                ndiFrameBusy = false;
                ndiProcess = null;
            }
        );
    } catch (error) {
        console.error(
            "Erro ao iniciar sender NDI:",
            error
        );

        stopNativePlayback();
        ndiReady = false;
        ndiFrameBusy = false;
        ndiProcess = null;
    }
}

function stopNdiSender() {
    stopNativePlayback();

    if (
        !ndiProcess ||
        ndiProcess.killed
    ) {
        return;
    }

    console.log(
        "Encerrando sender NDI..."
    );

    ndiFrameBusy = false;
    ndiReady = false;

    ndiProcess.kill();
    ndiProcess = null;
}

function startSystem() {
    console.log(
        "Inicializando Santtos TV Automation..."
    );

    initializeDatabase();
    addLog("Sistema iniciado");

    console.log("Banco de dados OK");
}

app.whenReady().then(() => {
    startSystem();
    startNdiSender();
    registerIpcHandlers();
    createWindow();

    app.on("activate", () => {
        if (
            BrowserWindow
                .getAllWindows()
                .length === 0
        ) {
            createWindow();
        }
    });
});

app.on("before-quit", () => {
    stopNativePlayback();
    stopNdiSender();
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
