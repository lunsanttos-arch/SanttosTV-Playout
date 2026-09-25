const {
    app,
    BrowserWindow,
    ipcMain,
    dialog,
    nativeImage,
    protocol,
    session,
    shell,
    safeStorage
} = require("electron");

const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("node:url");
const { MEDIA_SCHEME, createMediaProtocolHandler } = require("./media-protocol");
const { createSecretStore } = require("./secret-store");

protocol.registerSchemesAsPrivileged([
    {
        scheme: MEDIA_SCHEME,
        privileges: {
            standard: true,
            secure: true,
            stream: true,
            supportFetchAPI: true
        }
    }
]);
const { spawn } = require("child_process");
const crypto = require("node:crypto");
const { forwardCompleteFrames } = require("./frame-pump");
const ffmpegStatic = require("ffmpeg-static");

const {
    initializeDatabase,
    getSettings,
    updateOutputSettings,
    updateWatermarkStyle,
    updateHashtagStyle,
    addLog,
    getMedia,
    getTimeline,
    saveTimeline,
    getDailyRundown,
    saveDailyRundown,
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

const {
    checkMediaDecode
} = require(
    "../core/media/decode-check"
);

const {
    initializePlayoutReports,
    startPlayoutEntry,
    finishPlayoutEntry,
    closeOpenEntriesAsSkipped,
    getReportFolder
} = require(
    "../core/reporting/playout-report"
);

const {
    initializeLibraryCategories,
    getLibraryCategories,
    saveLibraryCategories,
    scanLibraryCategory
} = require(
    "../core/library/library-categories"
);

const isDevelopment = !app.isPackaged;
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
    app.quit();
}
app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    }
});

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
let secretStore = null;
let nativeSession = null;
let ndiQueuedFrames = 0;
let ndiAcknowledgedFrames = 0;
let ndiLastHeartbeatAt = 0;
let ndiRestartTimer = null;
let ndiWatchdogTimer = null;
let ndiRestartAttempts = 0;
let ndiShuttingDown = false;

function emitNdiEvent(event) {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send("ndi:event", event);
    }
}

function finishNativeSession(session, ok, message = "") {
    if (!session || session.cancelled || session.finished) return;
    session.finished = true;
    if (session.ackTimer) clearTimeout(session.ackTimer);
    if (nativeSession === session) {
        nativeSession = null;
        ffmpegProcess = null;
        nativePlaybackActive = false;
    }
    emitNdiEvent({
        type: ok ? "playback-finished" : "playback-failed",
        playbackId: session.playbackId,
        frames: session.framesQueued,
        startSeconds: session.startSeconds,
        error: ok ? null : message
    });
}

function maybeCompleteNativeSession(session) {
    if (!session || !session.ffmpegFinished || session.finished || session.cancelled) return;
    if (session.exitCode !== 0 || session.trailingBytes !== 0 || session.framesQueued === 0) {
        finishNativeSession(session, false, session.error || "Decodificação FFmpeg incompleta.");
        return;
    }
    if (ndiAcknowledgedFrames >= session.lastFrameSequence) {
        const estimatedFrames = Number.isFinite(session.plannedSeconds)
            ? Math.max(1, Math.round(session.plannedSeconds * 30000 / 1001))
            : 0;
        if (estimatedFrames && session.framesQueued < estimatedFrames - 2) {
            finishNativeSession(session, false, "O FFmpeg terminou antes do OUT previsto.");
        } else {
            finishNativeSession(session, true);
        }
        return;
    }
    if (!session.ackTimer) {
        session.ackTimer = setTimeout(() => {
            finishNativeSession(session, false, "O sender NDI não confirmou os últimos frames.");
        }, 10000);
    }
}

function onNdiFrameAck(counter) {
    if (!Number.isSafeInteger(counter) || counter <= ndiAcknowledgedFrames) return;
    ndiAcknowledgedFrames = counter;
    const session = nativeSession;
    if (!session || !session.framesQueued || session.cancelled) return;
    if (counter >= session.firstFrameSequence &&
        (counter - session.firstFrameSequence + 1) % 30 === 0) {
        emitNdiEvent({
            type: "playback-progress",
            playbackId: session.playbackId,
            currentSeconds: session.startSeconds +
                (counter - session.firstFrameSequence + 1) * 1001 / 30000
        });
    }
    maybeCompleteNativeSession(session);
}


// Somente o documento principal do Playout pode executar comandos com
// privilegios do processo principal. Iframes e janelas externas sao bloqueados.
function isTrustedIpcEvent(event) {
    return Boolean(
        mainWindow &&
        !mainWindow.isDestroyed() &&
        event.sender === mainWindow.webContents &&
        event.senderFrame === mainWindow.webContents.mainFrame
    );
}

function secureIpcHandle(channel, handler) {
    ipcMain.handle(channel, (event, ...args) => {
        if (!isTrustedIpcEvent(event)) {
            console.warn(`IPC nao autorizado bloqueado: ${channel}`);
            throw new Error("Origem IPC nao autorizada.");
        }
        return handler(event, ...args);
    });
}

function isAllowedMainNavigation(targetUrl, expectedUrl) {
    try {
        const target = new URL(targetUrl);
        const expected = new URL(expectedUrl);
        return (
            target.protocol === expected.protocol &&
            target.host === expected.host &&
            target.pathname === expected.pathname
        );
    } catch {
        return false;
    }
}

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
            webviewTag: false,
            devTools: isDevelopment,
            // Preview local com esquema privado e seek via HTTP Range.
            webSecurity: true,
            sandbox: true,
            preload: path.join(
                __dirname,
                "preload.js"
            )
        }
    });

    // Impede que links externos herdem acesso ao bridge privilegiado.
    const expectedUrl = isDevelopment
        ? "http://localhost:5173/"
        : pathToFileURL(
              path.join(__dirname, "../../dist/index.html")
          ).toString();

    mainWindow.webContents.setWindowOpenHandler(() => ({
        action: "deny"
    }));
    for (const eventName of ["will-navigate", "will-redirect"]) {
        mainWindow.webContents.on(eventName, (event, target) => {
            const targetUrl =
                typeof target === "string" ? target : target?.url;
            if (!isAllowedMainNavigation(targetUrl, expectedUrl)) {
                event.preventDefault();
            }
        });
    }

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

            const decodeSupport =
                await checkMediaDecode(
                    mediaItem.path,
                    metadata.videoStreamIndex
                );

            const compatibility = {
                ...(metadata.compatibility ?? {}),
                issues: [
                    ...(metadata.compatibility?.issues ?? [])
                ],
                warnings: [
                    ...(metadata.compatibility?.warnings ?? [])
                ]
            };

            if (!decodeSupport.decodable) {
                compatibility.issues.push(
                    "O FFmpeg não conseguiu decodificar a faixa de vídeo nem por hardware nem por software."
                );
            } else if (
                decodeSupport.preferredMode === "software"
            ) {
                compatibility.warnings.push(
                    "A aceleração por hardware não ficou disponível para esta mídia; o engine usará fallback de software."
                );
            }

            updateMediaMetadata(
                mediaItem.id,
                {
                    ...metadata,
                    status:
                        decodeSupport.decodable
                            ? metadata.status
                            : "incompatible",
                    compatibility,
                    decodeSupport,
                    decoderMode:
                        decodeSupport.preferredMode,
                    hardwareDecodeAvailable:
                        decodeSupport.hardwareAvailable,
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
    // Avoid spawning hundreds of simultaneous ffprobe/ffmpeg processes
    // when OPEC refreshes a large media folder.
    const MAX_PARALLEL_ANALYSES = 2;
    for (let i = 0; i < mediaItems.length; i += MAX_PARALLEL_ANALYSES) {
        await Promise.all(
            mediaItems.slice(i, i + MAX_PARALLEL_ANALYSES).map(analyzeMediaItem)
        );
    }
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

function buildFadeAlphaExpression(
    fadeIn,
    fadeOut,
    remainingSeconds,
    fadeSeconds
) {
    const d = Math.max(
        0,
        Number(fadeSeconds) || 0
    );
    const remaining = Math.max(
        0,
        Number(remainingSeconds) || 0
    );

    if (d <= 0) {
        return "1";
    }

    const parts = [];

    if (fadeIn) {
        parts.push(
            `if(lt(t\\,${d.toFixed(3)})\\,t/${d.toFixed(3)}\\,1)`
        );
    }

    if (fadeOut && remaining > d) {
        const fadeStart = Math.max(
            0,
            remaining - d
        );
        parts.push(
            `if(gt(t\\,${fadeStart.toFixed(3)})\\,max(0\\,(${remaining.toFixed(3)}-t)/${d.toFixed(3)})\\,1)`
        );
    }

    if (parts.length === 0) {
        return "1";
    }

    if (parts.length === 1) {
        return parts[0];
    }

    return `min(${parts[0]}\\,${parts[1]})`;
}

function buildProgramFilterGraph(
    hashtag,
    overlayState,
    hasWatermarkInput,
    videoStreamIndex = null
) {
    const state =
        overlayState &&
        typeof overlayState === "object"
            ? overlayState
            : {};

    const remaining = Math.max(
        0,
        (Number(state.durationSeconds) || 0) -
            (Number(state.startSeconds) || 0)
    );

    const sourceVideo =
        videoStreamIndex !== null &&
        videoStreamIndex !== undefined &&
        Number.isInteger(Number(videoStreamIndex)) &&
        Number(videoStreamIndex) >= 0
            ? `[0:${Number(videoStreamIndex)}]`
            : "[0:v:0]";

    const chains = [
        `${sourceVideo}scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30000/1001[base]`
    ];

    let current = "base";

    if (hasWatermarkInput) {
        const wm = getSettings().watermarkStyle;
        const fade = Math.max(
            0,
            Number(wm.fadeMs) / 1000
        );
        const filters = [
            `scale=${Math.round(wm.widthPx)}:-1`,
            "format=rgba",
            `colorchannelmixer=aa=${Math.max(
                0,
                Math.min(
                    1,
                    Number(wm.opacity) || 0
                )
            ).toFixed(3)}`
        ];

        if (
            state.watermarkFadeIn &&
            fade > 0
        ) {
            filters.push(
                `fade=t=in:st=0:d=${fade.toFixed(3)}:alpha=1`
            );
        }

        if (
            state.watermarkFadeOut &&
            remaining > fade &&
            fade > 0
        ) {
            filters.push(
                `fade=t=out:st=${Math.max(
                    0,
                    remaining - fade
                ).toFixed(3)}:d=${fade.toFixed(3)}:alpha=1`
            );
        }

        chains.push(
            `[1:v]${filters.join(",")}[wm]`
        );
        chains.push(
            `[${current}][wm]overlay=x=${Math.round(
                wm.x
            )}:y=${Math.round(
                wm.y
            )}:shortest=1:repeatlast=1[watermarked]`
        );
        current = "watermarked";
    }

    const text =
        typeof hashtag === "string"
            ? hashtag.trim()
            : "";

    if (text) {
        const style =
            getSettings().hashtagStyle;
        const alpha =
            buildFadeAlphaExpression(
                Boolean(state.hashtagFadeIn),
                Boolean(state.hashtagFadeOut),
                remaining,
                0.2
            );
        const options = [
            `fontfile='${resolveHashtagFont(style)}'`,
            `text='${escapeDrawtextText(text)}'`,
            `x=${Math.round(style.x)}`,
            `y=${Math.round(style.y)}`,
            `fontsize=${Math.round(style.fontSize)}`,
            `fontcolor=${toFfmpegColor(style.color, style.opacity)}`,
            `borderw=${Math.round(style.outlineWidth)}`,
            `bordercolor=${toFfmpegColor(style.outlineColor, style.outlineOpacity)}`,
            `alpha='${alpha}'`
        ];

        if (style.shadowEnabled) {
            options.push(
                `shadowcolor=${toFfmpegColor(style.shadowColor, style.shadowOpacity)}`,
                `shadowx=${Math.round(style.shadowX)}`,
                `shadowy=${Math.round(style.shadowY)}`
            );
        }

        chains.push(
            `[${current}]drawtext=${options.join(":")}[program]`
        );
        current = "program";
    }

    if (current != "program") {
        chains.push(
            `[${current}]null[program]`
        );
    }

    return chains.join(";");
}

function stopNativePlayback() {
    if (nativeSession) {
        nativeSession.cancelled = true;
        if (nativeSession.ackTimer) clearTimeout(nativeSession.ackTimer);
    }
    const processToStop = ffmpegProcess;
    nativeSession = null;
    ffmpegProcess = null;
    nativePlaybackActive = false;
    if (processToStop) {
        processToStop.stdout?.destroy();
        if (processToStop.exitCode === null && !processToStop.killed) {
            processToStop.kill();
        }
    }
}

function startNativePlayback(
    filePath,
    startSeconds = 0,
    hashtag = "",
    overlayState = {}
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
    const watermarkStyle =
        getSettings().watermarkStyle;
    const watermarkEnabled = Boolean(
        overlayState?.watermarkEnabled &&
        watermarkStyle?.filePath &&
        fs.existsSync(
            watermarkStyle.filePath
        )
    );
    const programState = {
        ...(overlayState && typeof overlayState === "object"
            ? overlayState
            : {}),
        startSeconds:
            normalizedStartSeconds
    };
    const normalizedOutPoint =
        programState.outPointSeconds !== null &&
        programState.outPointSeconds !== undefined &&
        Number.isFinite(Number(programState.outPointSeconds)) &&
        Number(programState.outPointSeconds) > normalizedStartSeconds
            ? Number(programState.outPointSeconds)
            : null;
    const clipRemainingSeconds =
        normalizedOutPoint !== null
            ? Math.max(
                  0.001,
                  normalizedOutPoint - normalizedStartSeconds
              )
            : null;

    console.log(
        `[GC] watermark=${watermarkEnabled ? "ON" : "OFF"}` +
            ` | file=${watermarkStyle?.filePath || "none"}` +
            ` | fadeIn=${Boolean(programState.watermarkFadeIn)}` +
            ` | fadeOut=${Boolean(programState.watermarkFadeOut)}` +
            ` | hashtag=${hashtag ? "ON" : "OFF"}` +
            ` | vstream=${programState.videoStreamIndex ?? "auto"}` +
            ` | astream=${programState.audioStreamIndex ?? "01"}` +
            ` | timing=${programState.timingMode ?? "unknown"}` +
            ` | OUT=${normalizedOutPoint ?? "EOF"}`
    );

    const args = [
        "-hide_banner",
        "-loglevel",
        "warning",
        "-nostdin",
        "-fflags",
        "+genpts+discardcorrupt",
        "-err_detect",
        "ignore_err",
        "-probesize",
        "10000000",
        "-analyzeduration",
        "10000000"
    ];

    if (normalizedStartSeconds > 0) {
        args.push(
            "-ss",
            normalizedStartSeconds.toFixed(3)
        );
    }

    args.push(
        "-i",
        filePath
    );

    if (clipRemainingSeconds !== null) {
        args.push(
            "-t",
            clipRemainingSeconds.toFixed(3)
        );
    }

    if (watermarkEnabled) {
        args.push(
            "-loop",
            "1",
            "-framerate",
            "30000/1001",
            "-i",
            watermarkStyle.filePath
        );
    }

    args.push(
        "-filter_complex",
        buildProgramFilterGraph(
            hashtag,
            programState,
            watermarkEnabled,
            programState.videoStreamIndex
        ),
        "-map",
        "[program]",
        "-an",
        "-sn",
        "-dn",
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

function validateWatermarkImage(filePath) {
    if (typeof filePath !== "string" || !filePath) {
        throw new Error("Arquivo de marca d'água inválido.");
    }

    if (!fs.existsSync(filePath)) {
        throw new Error("A imagem selecionada não foi encontrada.");
    }

    const extension = path.extname(filePath).toLowerCase();
    if (![".png", ".webp", ".jpg", ".jpeg"].includes(extension)) {
        throw new Error("Formato de imagem não suportado.");
    }

    const stat = fs.statSync(filePath);
    const maxFileBytes = 25 * 1024 * 1024;
    if (!stat.isFile() || stat.size <= 0) {
        throw new Error("O arquivo selecionado não é uma imagem válida.");
    }
    if (stat.size > maxFileBytes) {
        throw new Error("A marca d'água deve ter no máximo 25 MB.");
    }

    const image = nativeImage.createFromPath(filePath);
    if (!image || image.isEmpty()) {
        throw new Error("Não foi possível decodificar a imagem selecionada.");
    }

    const size = image.getSize();
    const maxDimension = 8192;
    const maxPixels = 32000000;
    if (
        size.width <= 0 ||
        size.height <= 0 ||
        size.width > maxDimension ||
        size.height > maxDimension ||
        size.width * size.height > maxPixels
    ) {
        throw new Error(
            `Imagem grande demais (${size.width}x${size.height}). Use até 8192 px por lado.`
        );
    }

    return {
        filePath,
        width: size.width,
        height: size.height,
        fileSize: stat.size
    };
}

function createWatermarkPreviewDataUrl(filePath) {
    const validation = validateWatermarkImage(filePath);
    const image = nativeImage.createFromPath(validation.filePath);

    if (!image || image.isEmpty()) {
        throw new Error("Não foi possível criar o preview da marca d'água.");
    }

    const size = image.getSize();
    const previewWidth = Math.min(640, Math.max(1, size.width));
    const previewImage = size.width > previewWidth
        ? image.resize({
              width: previewWidth,
              quality: "good"
          })
        : image;

    return {
        dataUrl: previewImage.toDataURL(),
        width: size.width,
        height: size.height
    };
}

function registerIpcHandlers() {
    secureIpcHandle("ndi:website", async () => {
        await shell.openExternal("https://ndi.video/");
        return { ok: true };
    });

    secureIpcHandle(
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

    secureIpcHandle(
        "ndi:play-file",
        async (
            _event,
            filePath,
            startSeconds = 0,
            hashtag = "",
            overlayState = {}
        ) => {
            try {
                return startNativePlayback(
                    filePath,
                    startSeconds,
                    hashtag,
                    overlayState
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

    secureIpcHandle(
        "ndi:stop-file",
        async () => {
            stopNativePlayback();
            return { ok: true };
        }
    );

    secureIpcHandle(
        "library-categories:get",
        async () => getLibraryCategories()
    );

    secureIpcHandle(
        "library-categories:save",
        async (_event, categories) => {
            try {
                return {
                    ok: true,
                    categories: saveLibraryCategories(categories)
                };
            } catch (error) {
                return {
                    ok: false,
                    error: error instanceof Error
                        ? error.message
                        : "Não foi possível salvar as abas da Biblioteca."
                };
            }
        }
    );

    secureIpcHandle(
        "library-categories:select-folder",
        async () => {
            const result = await dialog.showOpenDialog(
                mainWindow ?? undefined,
                {
                    title: "Selecionar pasta da Biblioteca",
                    properties: ["openDirectory", "createDirectory"]
                }
            );

            if (result.canceled || result.filePaths.length === 0) {
                return { ok: false, canceled: true };
            }

            return { ok: true, folderPath: result.filePaths[0] };
        }
    );

    secureIpcHandle(
        "library-categories:scan",
        async (_event, categoryId) => {
            try {
                return {
                    ok: true,
                    ...scanLibraryCategory(categoryId)
                };
            } catch (error) {
                return {
                    ok: false,
                    error: error instanceof Error
                        ? error.message
                        : "Não foi possível atualizar a pasta da Biblioteca."
                };
            }
        }
    );

    secureIpcHandle(
        "settings:get",
        async () => {
            const settings = getSettings();
            if (secretStore && secretStore.isAvailable()) {
                try {
                    settings.output.srt.passphrase = secretStore.read();
                } catch (error) {
                    console.error("Não foi possível ler a senha protegida SRT:", error.message);
                    settings.output.srt.passphrase = "";
                }
            } else {
                settings.output.srt.passphrase = "";
            }
            return settings;
        }
    );

    secureIpcHandle(
        "settings:set-output",
        async (_event, output) => {
            try {
                const passphrase = output?.srt?.passphrase ?? "";
                if (typeof passphrase !== "string") {
                    throw new Error("Senha SRT inválida.");
                }
                if (passphrase) {
                    secretStore.write(passphrase);
                } else {
                    secretStore.clear();
                }
                const settings = {
                    ...output,
                    srt: { ...output.srt, passphrase: "" }
                };
                const saved = updateOutputSettings(settings);
                return {
                    ok: true,
                    output: {
                        ...saved,
                        srt: { ...saved.srt, passphrase }
                    }
                };
            } catch (error) {
                return {
                    ok: false,
                    error: error instanceof Error
                        ? error.message
                        : "Não foi possível salvar configurações."
                };
            }
        }
    );

    secureIpcHandle(
        "settings:set-hashtag-style",
        async (_event, style) => ({
            ok: true,
            hashtagStyle:
                updateHashtagStyle(style)
        })
    );

    secureIpcHandle(
        "watermark:preview",
        async (_event, filePath) => {
            try {
                const preview =
                    createWatermarkPreviewDataUrl(
                        filePath
                    );

                return {
                    ok: true,
                    ...preview
                };
            } catch (error) {
                console.error(
                    "Falha ao gerar preview da marca d'água:",
                    error
                );

                return {
                    ok: false,
                    error:
                        error instanceof Error
                            ? error.message
                            : "Não foi possível gerar o preview."
                };
            }
        }
    );

    secureIpcHandle(
        "watermark:select",
        async () => {
            try {
                const result =
                    await dialog.showOpenDialog(
                        mainWindow ?? undefined,
                        {
                            title:
                                "Selecionar marca d'água",
                            properties: [
                                "openFile"
                            ],
                            filters: [
                                {
                                    name: "Imagens",
                                    extensions: [
                                        "png",
                                        "webp",
                                        "jpg",
                                        "jpeg"
                                    ]
                                }
                            ]
                        }
                    );

                if (
                    result.canceled ||
                    result.filePaths.length === 0
                ) {
                    return {
                        ok: false,
                        canceled: true
                    };
                }

                const validation =
                    validateWatermarkImage(
                        result.filePaths[0]
                    );

                return {
                    ok: true,
                    filePath: validation.filePath,
                    image: {
                        width: validation.width,
                        height: validation.height,
                        fileSize: validation.fileSize
                    }
                };
            } catch (error) {
                console.error(
                    "Falha ao selecionar marca d'água:",
                    error
                );

                return {
                    ok: false,
                    canceled: false,
                    error:
                        error instanceof Error
                            ? error.message
                            : "Não foi possível abrir a imagem."
                };
            }
        }
    );

    secureIpcHandle(
        "settings:set-watermark-style",
        async (_event, style) => {
            try {
                if (style?.filePath) {
                    validateWatermarkImage(
                        style.filePath
                    );
                }

                return {
                    ok: true,
                    watermarkStyle:
                        updateWatermarkStyle(style)
                };
            } catch (error) {
                console.error(
                    "Falha ao salvar marca d'água:",
                    error
                );

                return {
                    ok: false,
                    error:
                        error instanceof Error
                            ? error.message
                            : "Não foi possível salvar a marca d'água."
                };
            }
        }
    );

    secureIpcHandle(
        "report:playout-start",
        async (_event, mediaItem) => {
            try {
                return {
                    ok: true,
                    ...startPlayoutEntry(mediaItem)
                };
            } catch (error) {
                console.error(
                    "Falha ao iniciar registro de exibição:",
                    error
                );
                return {
                    ok: false,
                    error: error instanceof Error
                        ? error.message
                        : "Não foi possível iniciar o registro de exibição."
                };
            }
        }
    );

    secureIpcHandle(
        "report:playout-finish",
        async (_event, entryId, status, playedSeconds) => {
            try {
                return finishPlayoutEntry(
                    entryId,
                    status,
                    playedSeconds
                );
            } catch (error) {
                console.error(
                    "Falha ao finalizar registro de exibição:",
                    error
                );
                return {
                    ok: false,
                    error: error instanceof Error
                        ? error.message
                        : "Não foi possível finalizar o registro de exibição."
                };
            }
        }
    );

    secureIpcHandle(
        "report:folder",
        async () => ({
            ok: true,
            folder: getReportFolder()
        })
    );

    secureIpcHandle(
        "rundown:get",
        async (_event, date) => getDailyRundown(date)
    );

    secureIpcHandle(
        "rundown:save",
        async (_event, rundown) => {
            try {
                return {
                    ok: true,
                    rundown: saveDailyRundown(rundown)
                };
            } catch (error) {
                console.error("Falha ao salvar roteiro diário:", error);
                return {
                    ok: false,
                    error: error instanceof Error
                        ? error.message
                        : "Não foi possível salvar o roteiro."
                };
            }
        }
    );

    secureIpcHandle(
        "timeline:list",
        async () => getTimeline()
    );

    secureIpcHandle(
        "timeline:save",
        async (_event, timelineItems) =>
            saveTimeline(timelineItems)
    );

    ipcMain.on(
        "ndi:frame",
        (event, frameData) => {
            if (!isTrustedIpcEvent(event)) {
                console.warn("Frame NDI nao autorizado bloqueado.");
                return;
            }
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

            // Rejeitar tamanho e tipo ANTES de criar uma copia de 8MB.
            if (
                !(frameData instanceof Uint8Array) ||
                frameData.byteLength !== NDI_FRAME_SIZE
            ) {
                console.warn("Frame NDI invalido ou fora do tamanho esperado.");
                return;
            }

            const frameBuffer = Buffer.from(frameData);

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

    secureIpcHandle(
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
                                "mov",
                                "mkv",
                                "avi",
                                "mxf",
                                "ts",
                                "mts",
                                "m2ts",
                                "webm",
                                "mpg",
                                "mpeg",
                                "m4v",
                                "wmv"
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

    secureIpcHandle(
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

    secureIpcHandle(
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

    secureIpcHandle(
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

    const ndiExecutable = app.isPackaged
        ? path.join(process.resourcesPath, "ndi", "ndi_test.exe")
        : path.join(__dirname, "../core/ndi/ndi_test.exe");

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

    initializeDatabase(app.getPath("userData"));
    secretStore = createSecretStore(app.getPath("userData"), safeStorage);
    // Remove any legacy plaintext SRT password on first startup after upgrade.
    const oldSettings = getSettings();
    const legacyPassphrase = oldSettings?.output?.srt?.passphrase;
    if (legacyPassphrase) {
        if (!secretStore.isAvailable()) {
            console.error("Senha SRT antiga ainda sem migrar: proteção do Windows indisponível.");
        } else {
            secretStore.write(legacyPassphrase);
            updateOutputSettings({
                ...oldSettings.output,
                srt: { ...oldSettings.output.srt, passphrase: "" }
            });
        }
    }
    initializeLibraryCategories(app.getPath("userData"));
    initializePlayoutReports({
        userDataPath: app.getPath("userData"),
        documentsPath: app.getPath("documents")
    });
    addLog("Sistema iniciado");

    console.log("Banco de dados OK");
    console.log(
        `Relatórios de exibição: ${getReportFolder()}`
    );
}

app.whenReady().then(() => {
    if (!hasSingleInstanceLock) return;
    startSystem();
    session.defaultSession.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false)
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    protocol.handle(MEDIA_SCHEME, createMediaProtocolHandler(getMedia));

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
    closeOpenEntriesAsSkipped();
    stopNativePlayback();
    stopNdiSender();
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
