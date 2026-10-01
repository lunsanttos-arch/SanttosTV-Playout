const {
    app,
    BrowserWindow,
    ipcMain,
    dialog,
    nativeImage,
    protocol,
    session
} = require("electron");

const path = require("path");
const fs = require("fs");
const { fileURLToPath } = require("url");
const { MEDIA_SCHEME, serveImportedVideo } = require("../core/media/media-protocol");
const { preparePreviewProxy, cancelActivePreviews } = require("../core/media/preview-proxy");
const { buildExhibitionDrawtext } = require("../core/graphics/exhibition-overlay");
const { spawn } = require("child_process");
const crypto = require("node:crypto");
const { checkNdiRuntime } = require("../core/ndi/ndi-capabilities");
const { NdiAudioSource } = require("../core/audio/ndi-audio-source");
const { FixedFrameAssembler } = require("../core/ndi/frame-aligner");
const { NativePlayoutEngine } = require("../core/playout/native-playout-engine");
const {
    outputProfile,
    profileSignature
} = require("../core/playout/output-profile");
const ffmpegStatic = require("ffmpeg-static");
const { configureTestBench } = require("./testbench");

const {
    initializeDatabase,
    getSettings,
    updateOutputSettings,
    updateWatermarkStyle,
    updateHashtagStyle,
    updateExhibitionStyle,
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
    getReportFolder,
    setReportFolder,
    resetReportFolder
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

const {
    initializeWebInputs,
    getWebInputs,
    saveWebInput,
    removeWebInput
} = require(
    "../core/library/web-inputs"
);

const testBenchConfig = configureTestBench(app);
const isTestBench = testBenchConfig.enabled;
const isNdiTestBench = testBenchConfig.ndiEnabled;
const nativeOutputAllowed = !isTestBench || isNdiTestBench;
let ndiSourceName = isNdiTestBench ? "Santtos TV - QA" : "Santtos TV - PROGRAM";
const isDevelopment = !app.isPackaged;

// Um protocolo exclusivo permite reproduzir midias com webSecurity habilitado.
protocol.registerSchemesAsPrivileged([{
    scheme: MEDIA_SCHEME,
    privileges: { standard: true, secure: true, stream: true }
}]);

function isTrustedRendererUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        if (isDevelopment) {
            return parsed.origin === "http://localhost:5173" &&
                parsed.pathname === "/";
        }
        if (parsed.protocol !== "file:") return false;
        return path.resolve(fileURLToPath(parsed)) ===
            path.resolve(__dirname, "../../dist/index.html");
    } catch {
        return false;
    }
}

function isTrustedIpcSender(event) {
    return Boolean(
        mainWindow && !mainWindow.isDestroyed() &&
        event?.sender === mainWindow.webContents &&
        event?.senderFrame === mainWindow.webContents.mainFrame &&
        isTrustedRendererUrl(event.senderFrame.url)
    );
}

function registerTrustedHandle(channel, listener) {
    ipcMain.handle(channel, (event, ...args) => {
        if (!isTrustedIpcSender(event)) throw new Error("Origem IPC nao autorizada.");
        return listener(event, ...args);
    });
}

function registerTrustedOn(channel, listener) {
    ipcMain.on(channel, (event, ...args) => {
        if (!isTrustedIpcSender(event)) return;
        return listener(event, ...args);
    });
}


const FONT_FILES = {
    "Arial": {
        regular: ["arial.ttf"],
        bold: ["arialbd.ttf"]
    },
    "Segoe UI": {
        regular: ["segoeui.ttf"],
        bold: ["segoeuib.ttf"]
    },
    "Montserrat": {
        regular: ["Montserrat-Regular.ttf", "Montserrat.ttf"],
        bold: ["Montserrat-Bold.ttf", "Montserrat.ttf"]
    },
    "Inter": {
        regular: ["Inter-Regular.ttf", "Inter.ttf"],
        bold: ["Inter-Bold.ttf", "Inter.ttf"]
    },
    "Poppins": {
        regular: ["Poppins-Regular.ttf"],
        bold: ["Poppins-Bold.ttf"]
    },
    "Oswald": {
        regular: ["Oswald-Regular.ttf", "Oswald.ttf"],
        bold: ["Oswald-Bold.ttf", "Oswald.ttf"]
    },
    "Roboto Condensed": {
        regular: [
            "RobotoCondensed-Regular.ttf",
            "RobotoCondensed.ttf"
        ],
        bold: [
            "RobotoCondensed-Bold.ttf",
            "RobotoCondensed.ttf"
        ]
    },
    "Tahoma": {
        regular: ["tahoma.ttf"],
        bold: ["tahomabd.ttf"]
    },
    "Verdana": {
        regular: ["verdana.ttf"],
        bold: ["verdanab.ttf"]
    },
    "Calibri": {
        regular: ["calibri.ttf"],
        bold: ["calibrib.ttf"]
    }
};

let mainWindow = null;
let ndiProcess = null;
let ffmpegProcess = null;

let ndiReady = false;
let ndiFrameBusy = false;
let ndiLastError = "";
let ndiRestartTimer = null;
let ndiRestartFailures = 0;
let ndiStopping = false;
let nativePlaybackActive = false;
let playoutLastError = "";
let ndiAudioPipe = "";
let ndiAudioReady = false;
let ndiAudioSupported = false;
let ndiAudioNativeActive = false;
let audioSource = null;
let audioOutputStatus = "IDLE";
let audioOutputError = "";
let stopNdiFrameFeed = null;
let activeOutputProfile = outputProfile({});
let activeOutputSignature = profileSignature(activeOutputProfile);
const playoutEngine = new NativePlayoutEngine();
function onPlayoutFault(message) {
    playoutLastError = message;
    nativePlaybackActive = false;
    playoutEngine.fault(message);

    // Em falha inesperada, enviar um frame preto valido ao sender:
    // evita que o ultimo frame do comercial congele sem aviso.
    if (ndiReady && ndiProcess?.stdin && !ndiProcess.stdin.destroyed) {
        ndiProcess.stdin.write(
            Buffer.alloc(activeOutputProfile.frameSize),
            (error) => {
                if (error) {
                    console.error(
                        "Nao foi possivel limpar o PROGRAM NDI:",
                        error
                    );
                }
            }
        );
    }
}

const analysesInProgress = new Map();
const approvedPreviewPaths = new Set();

function resolveAppIcon() {
    const candidate = app.isPackaged
        ? path.join(process.resourcesPath, "icon.ico")
        : path.join(
              __dirname,
              "../../build-resources/icon.ico"
          );

    return fs.existsSync(candidate)
        ? candidate
        : undefined;
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1500,
        height: 900,
        minWidth: 1100,
        minHeight: 700,
        backgroundColor: "#0b0b0b",
        icon: resolveAppIcon(),
        title: isNdiTestBench ? "Santtos TV Automation — TESTE NDI (FONTE QA)"
            : isTestBench ? "Santtos TV Automation — BANCADA"
            : "Santtos TV Automation",
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true,
            sandbox: true,
            preload: path.join(
                __dirname,
                "preload.js"
            )
        }
    });

    mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
        if (!isTrustedRendererUrl(targetUrl)) event.preventDefault();
    });
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
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
    // Em SMB/NAS, um probe por vez evita saturar o compartilhamento e
    // competir com a leitura do arquivo que estiver efetivamente NO AR.
    const hasNetworkMedia =
        mediaItems.some(
            (item) =>
                typeof item?.path === "string" &&
                /^\\\\/.test(item.path)
        );
    const poolSize =
        hasNetworkMedia
            ? Math.min(1, mediaItems.length)
            : Math.min(2, mediaItems.length);
    let nextIndex = 0;
    await Promise.all(Array.from({ length: poolSize }, async () => {
        while (nextIndex < mediaItems.length) {
            const item = mediaItems[nextIndex++];
            await analyzeMediaItem(item);
        }
    }));
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

    const fileNames = style.bold
        ? family.bold
        : family.regular;

    const windowsFolder =
        process.env.WINDIR ||
        "C:\\Windows";
    const localFonts = path.join(
        process.env.LOCALAPPDATA || "",
        "Microsoft",
        "Windows",
        "Fonts"
    );
    const folders = [
        path.join(windowsFolder, "Fonts"),
        localFonts
    ];

    let candidate = null;

    for (const folder of folders) {
        if (!folder) continue;
        for (const fileName of fileNames) {
            const fullPath = path.join(
                folder,
                fileName
            );
            if (fs.existsSync(fullPath)) {
                candidate = fullPath;
                break;
            }
        }
        if (candidate) break;
    }

    const fallback = path.join(
        windowsFolder,
        "Fonts",
        style.bold
            ? "arialbd.ttf"
            : "arial.ttf"
    );

    return (candidate || fallback)
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
    videoStreamIndex = null,
    profile = activeOutputProfile
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
        Number.isInteger(Number(videoStreamIndex))
            ? `[0:${Number(videoStreamIndex)}]`
            : "[0:v:0]";

    const scaleX = profile.width / 1920;
    const scaleY = profile.height / 1080;
    const fontScale = Math.min(scaleX, scaleY);
    const workingFpsN =
        profile.scanMode === "interlaced"
            ? profile.fpsN * 2
            : profile.fpsN;

    const fitMode =
        ["contain", "cover", "stretch"].includes(
            state.fitMode
        )
            ? state.fitMode
            : "contain";

    const sizePercent =
        Math.max(
            10,
            Math.min(
                100,
                Number(state.sizePercent) || 100
            )
        );
    const targetWidth =
        Math.max(
            2,
            Math.round(
                profile.width *
                sizePercent /
                100
            )
        );
    const targetHeight =
        Math.max(
            2,
            Math.round(
                profile.height *
                sizePercent /
                100
            )
        );

    const geometryFilter =
        fitMode === "stretch"
            ? `scale=${targetWidth}:${targetHeight},pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2:black`
            : fitMode === "cover"
              ? `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight},pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2:black`
              : `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:black,pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2:black`;

    const chains = [
        `${sourceVideo}${geometryFilter},` +
        `setsar=${profile.sar.toFixed(6)},fps=${workingFpsN}/${profile.fpsD}[base]`
    ];

    let current = "base";

    if (hasWatermarkInput) {
        const wm = getSettings().watermarkStyle;
        const fade = Math.max(
            0,
            Number(wm.fadeMs) / 1000
        );
        const filters = [
            `scale=${Math.max(1, Math.round(wm.widthPx * scaleX))}:-1`,
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
                wm.x * scaleX
            )}:y=${Math.round(
                wm.y * scaleY
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
            `x=${Math.round(style.x * scaleX)}`,
            `y=${Math.round(style.y * scaleY)}`,
            `fontsize=${Math.max(1, Math.round(style.fontSize * fontScale))}`,
            `fontcolor=${toFfmpegColor(style.color, style.opacity)}`,
            `borderw=${Math.max(0, Math.round(style.outlineWidth * fontScale))}`,
            `bordercolor=${toFfmpegColor(style.outlineColor, style.outlineOpacity)}`,
            `alpha='${alpha}'`
        ];

        if (style.shadowEnabled) {
            options.push(
                `shadowcolor=${toFfmpegColor(style.shadowColor, style.shadowOpacity)}`,
                `shadowx=${Math.round(style.shadowX * scaleX)}`,
                `shadowy=${Math.round(style.shadowY * scaleY)}`
            );
        }

        chains.push(
            `[${current}]drawtext=${options.join(":")}[withHashtag]`
        );
        current = "withHashtag";
    }

    if (state.exhibitionType && state.exhibitionType !== "NORMAL") {
        const graphics = getSettings();
        const identification = buildExhibitionDrawtext(
            current,
            state.exhibitionType,
            graphics.watermarkStyle,
            resolveHashtagFont(graphics.exhibitionStyle)
                .replaceAll("\\\\", "/"),
            graphics.exhibitionStyle,
            {
                width: profile.width,
                height: profile.height
            }
        );
        if (identification) {
            chains.push(identification);
            current = "exhibition";
        }
    }

    if (profile.scanMode === "interlaced") {
        chains.push(
            `[${current}]tinterlace=mode=interleave_top,format=${profile.ffmpegPixelFormat}[program]`
        );
    } else {
        chains.push(
            `[${current}]format=${profile.ffmpegPixelFormat}[program]`
        );
    }

    return chains.join(";");
}

function stopNativePlayback({ engineAction = "stop" } = {}) {
    if (engineAction === "pause") {
        playoutEngine.pause();
    } else if (engineAction === "stop") {
        playoutEngine.stop();
    }

    if (stopNdiFrameFeed) {
        stopNdiFrameFeed();
        stopNdiFrameFeed = null;
    }
    if (audioSource) {
        audioSource.stop();
        audioSource = null;
    }
    audioOutputStatus = "IDLE";
    audioOutputError = "";

    if (!ffmpegProcess) {
        nativePlaybackActive = false;
        return playoutEngine.snapshot();
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

    return playoutEngine.snapshot();
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

    const isRemoteInput =
        overlayState?.sourceType === "input" &&
        /^(https?:\/\/|srt:\/\/)/i.test(filePath);

    const imported = isRemoteInput
        ? getWebInputs().some(
              (item) =>
                  item.url === filePath
          )
        : getMedia().some((item) =>
              typeof item.path === "string" &&
              path.resolve(item.path) === path.resolve(filePath)
          );

    if (isRemoteInput) {
        if (!imported) {
            throw new Error(
                "O input deve estar cadastrado em Biblioteca → Inputs."
            );
        }
    } else if (
        !imported ||
        !fs.existsSync(filePath) ||
        !fs.statSync(filePath).isFile()
    ) {
        throw new Error(
            "O arquivo deve estar cadastrado na biblioteca."
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
        const detail = ndiLastError
            ? " " + ndiLastError
            : "";
        throw new Error(
            "Engine NDI ainda não está pronto." +
            detail
        );
    }

    stopNativePlayback({ engineAction: "preserve" });
    playoutLastError = "";

    const ffmpegPath = resolveFfmpegPath();
    const profile = activeOutputProfile;
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
    const normalizedInPoint =
        Number.isFinite(Number(programState.inPointSeconds))
            ? Math.max(0, Number(programState.inPointSeconds))
            : normalizedStartSeconds;
    const normalizedOutPoint =
        Number.isFinite(Number(programState.outPointSeconds))
            ? Math.max(
                  normalizedStartSeconds,
                  Number(programState.outPointSeconds)
              )
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
            ` | exhibition=${programState.exhibitionType ?? "NORMAL"}` +
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

    if (
        normalizedStartSeconds > 0 &&
        !isRemoteInput
    ) {
        args.push(
            "-ss",
            normalizedStartSeconds.toFixed(3)
        );
    }

    if (isRemoteInput) {
        if (/^https?:\/\//i.test(filePath)) {
            args.push(
                "-reconnect",
                "1",
                "-reconnect_streamed",
                "1",
                "-reconnect_delay_max",
                "4"
            );
        }
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
            profile.scanMode === "interlaced"
                ? `${profile.fpsN * 2}/${profile.fpsD}`
                : profile.fpsExpression,
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
            programState.videoStreamIndex,
            profile
        ),
        "-map",
        "[program]",
        "-an",
        "-sn",
        "-dn",
        "-pix_fmt",
        profile.ffmpegPixelFormat,
        "-f",
        "rawvideo",
        "pipe:1"
    );

    console.log(
        `Iniciando playout FFmpeg: ${path.basename(filePath)} @ ${normalizedStartSeconds.toFixed(3)}s` +
        ` | ${profile.resolution} ${profile.fpsText} ${profile.scanMode} ${profile.pixelFormat}` +
        `${hashtag ? ` | ${hashtag}` : ""}`
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
    playoutEngine.start({
        filePath,
        itemId:
            typeof programState.itemId === "string"
                ? programState.itemId
                : null,
        inPointSeconds: normalizedInPoint,
        startSeconds: normalizedStartSeconds,
        outPointSeconds: normalizedOutPoint
    });

    const selectedAudioIndex = programState.audioStreamIndex;
    if (ndiAudioSupported && ndiAudioReady && ndiAudioPipe) {
        try {
            audioSource = new NdiAudioSource({
                pipePath: ndiAudioPipe,
                ffmpegPath,
                filePath,
                // Midias importadas antes do suporte de áudio não possuem
                // audioStreamIndex no banco. Nesse caso o FFmpeg usa 0:a:0.
                streamIndex: Number.isSafeInteger(selectedAudioIndex) &&
                    selectedAudioIndex >= 0
                        ? selectedAudioIndex
                        : null,
                startSeconds: normalizedStartSeconds,
                durationSeconds: clipRemainingSeconds,
                sampleRate: profile.sampleRate,
                channels: profile.channels
            }).start();
            audioOutputStatus = "STARTING";
            audioOutputError = "";
        } catch (error) {
            audioOutputStatus = "ERROR";
            audioOutputError = String(error?.message || error);
            console.error("Falha ao iniciar áudio NDI:", error);
        }
    } else {
        audioOutputStatus = ndiAudioSupported ? "PIPE_NOT_READY" : "REBUILD_REQUIRED";
        audioOutputError = ndiAudioSupported
            ? "Canal de áudio ainda não foi aberto pelo sender NDI."
            : "Atualize ndi_test.exe para o sender NDI com perfil dinâmico.";
    }

    // rawvideo is a byte stream without delimiters. Never pipe it
    // directly into the persistent NDI sender: stopping/seeking FFmpeg can
    // leave a partial frame in stdin and the next clip would complete it,
    // producing a picture made from two different frames.
    let feedActive = true;
    const assembler = new FixedFrameAssembler(
        profile.frameSize,
        (completeFrame) => {
            if (
                !feedActive ||
                ffmpegProcess !== processRef ||
                !ndiProcess?.stdin ||
                ndiProcess.stdin.destroyed
            ) {
                return;
            }

            const canContinue = ndiProcess.stdin.write(completeFrame);
            if (!canContinue && processRef.stdout && !processRef.stdout.destroyed) {
                processRef.stdout.pause();
                ndiProcess.stdin.once("drain", () => {
                    if (
                        feedActive &&
                        ffmpegProcess === processRef &&
                        processRef.stdout &&
                        !processRef.stdout.destroyed
                    ) {
                        processRef.stdout.resume();
                    }
                });
            }
        }
    );

    const onVideoBytes = (chunk) => assembler.push(chunk);
    processRef.stdout.on("data", onVideoBytes);

    const stopThisFeed = () => {
        if (!feedActive) return;
        feedActive = false;
        processRef.stdout.off("data", onVideoBytes);
        const result = assembler.stop();
        if (result.droppedBytes > 0) {
            console.log(
                `Frame ${profile.ndiPixelFormat} parcial descartado na troca: ${result.droppedBytes} bytes.`
            );
        }
    };
    stopNdiFrameFeed = stopThisFeed;

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
                onPlayoutFault("Erro no decodificador FFmpeg: " + error.message);
            }
        }
    );

    processRef.on(
        "exit",
        (code, signal) => {
            stopThisFeed();
            if (stopNdiFrameFeed === stopThisFeed) {
                stopNdiFrameFeed = null;
            }

            console.log(
                `Playout FFmpeg encerrado. Código: ${code}, sinal: ${signal}`
            );

            if (ffmpegProcess === processRef) {
                ffmpegProcess = null;
                if (code === 0 && !signal) {
                    nativePlaybackActive = false;
                    if (audioSource) {
                        audioSource.stop();
                        audioSource = null;
                    }
                    audioOutputStatus = "IDLE";
                    const ended = playoutEngine.complete();

                    // O motor nativo, e não o elemento <video> do Chromium,
                    // determina o fim real do bloco.
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send(
                            "playout:native-ended",
                            ended
                        );
                    }
                } else {
                    onPlayoutFault(
                        `O FFmpeg parou durante o programa (codigo ${code}; sinal ${signal || "-"}).`
                    );
                }
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
    registerTrustedHandle(
        "ndi:status",
        async () => ({
            online:
                ndiReady &&
                Boolean(ndiProcess) &&
                !ndiProcess.killed,
            source: ndiSourceName,
            profile: {
                ...activeOutputProfile,
                signature: activeOutputSignature
            },
            ndiTestMode: isNdiTestBench,
            audio: audioSource
                ? { ...audioSource.snapshot(), route: ndiSourceName,
                    nativeActive: ndiAudioNativeActive,
                    receiverVerified: false }
                : { state: audioOutputStatus, error: audioOutputError || null,
                    active: false, leftDb: -60, rightDb: -60,
                    peakLeftDb: -60, peakRightDb: -60,
                    nativeActive: ndiAudioNativeActive,
                    sampleRate: activeOutputProfile.sampleRate,
                    channels: activeOutputProfile.channels,
                    receiverVerified: false, route: ndiSourceName },
            nativePlaybackActive,
            playout: playoutEngine.snapshot(),
            playoutError: playoutLastError || null,
            error: ndiLastError || null,
            restarting: Boolean(ndiRestartTimer),
            testBench: isTestBench
        })
    );

    registerTrustedHandle(
        "ndi:play-file",
        async (
            _event,
            filePath,
            startSeconds = 0,
            hashtag = "",
            overlayState = {}
        ) => {
            if (!nativeOutputAllowed) return { ok: true, previewOnly: true };
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

    registerTrustedHandle(
        "playout:pause",
        async () => {
            const playout = stopNativePlayback({
                engineAction: "pause"
            });
            return { ok: true, playout };
        }
    );

    registerTrustedHandle(
        "playout:seek",
        async (_event, positionSeconds) => {
            const playout = playoutEngine.seek(positionSeconds);
            return { ok: true, playout };
        }
    );

    registerTrustedHandle(
        "ndi:stop-file",
        async () => {
            const playout = stopNativePlayback({
                engineAction: "stop"
            });
            return { ok: true, playout };
        }
    );

    registerTrustedHandle(
        "library-categories:get",
        async () => getLibraryCategories()
    );

    registerTrustedHandle(
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

    registerTrustedHandle(
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

    registerTrustedHandle(
        "library-categories:scan",
        async (_event, categoryId) => {
            try {
                return {
                    ok: true,
                    ...(await scanLibraryCategory(categoryId))
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

    registerTrustedHandle(
        "web-inputs:get",
        async () => ({
            ok: true,
            inputs: getWebInputs()
        })
    );

    registerTrustedHandle(
        "web-inputs:save",
        async (_event, input) => {
            try {
                return {
                    ok: true,
                    input: saveWebInput(input),
                    inputs: getWebInputs()
                };
            } catch (error) {
                return {
                    ok: false,
                    error:
                        error instanceof Error
                            ? error.message
                            : "Não foi possível salvar o input."
                };
            }
        }
    );

    registerTrustedHandle(
        "web-inputs:remove",
        async (_event, id) => ({
            ok: true,
            ...removeWebInput(id)
        })
    );

    registerTrustedHandle(
        "settings:get",
        async () => getSettings()
    );

    registerTrustedHandle(
        "settings:set-output",
        async (_event, output) => {
            try {
                const engineState =
                    playoutEngine.snapshot().state;
                if (
                    engineState === "PLAYING" ||
                    engineState === "PAUSED"
                ) {
                    return {
                        ok: false,
                        error:
                            "Pare o PROGRAM antes de alterar o perfil técnico da saída NDI."
                    };
                }

                const saved =
                    updateOutputSettings(output);

                // O sender carrega resolução/FPS/scan/pixel/audio/nome
                // na inicialização. Aplicar o perfil salvo imediatamente.
                if (nativeOutputAllowed) {
                    restartNdiSenderForProfile();
                }

                return {
                    ok: true,
                    output: saved,
                    profile:
                        configuredOutputProfile(),
                    restarting:
                        Boolean(
                            configuredOutputProfile()
                                .ndiEnabled
                        )
                };
            } catch (error) {
                console.error(
                    "Falha ao aplicar perfil de saída:",
                    error
                );
                return {
                    ok: false,
                    error:
                        error instanceof Error
                            ? error.message
                            : "Não foi possível aplicar o perfil de saída."
                };
            }
        }
    );

    registerTrustedHandle(
        "settings:set-hashtag-style",
        async (_event, style) => ({
            ok: true,
            hashtagStyle:
                updateHashtagStyle(style)
        })
    );

    registerTrustedHandle(
        "settings:set-exhibition-style",
        async (_event, style) => ({
            ok: true,
            exhibitionStyle: updateExhibitionStyle(style)
        })
    );

    registerTrustedHandle(
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

    registerTrustedHandle(
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

    registerTrustedHandle(
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

    registerTrustedHandle(
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

    registerTrustedHandle(
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

    registerTrustedHandle(
        "report:folder",
        async () => ({
            ok: true,
            folder: getReportFolder()
        })
    );

    registerTrustedHandle(
        "report:select-folder",
        async () => {
            const result = await dialog.showOpenDialog(
                mainWindow ?? undefined,
                {
                    title: "Selecionar pasta dos relatórios XML",
                    properties: [
                        "openDirectory",
                        "createDirectory"
                    ]
                }
            );

            if (
                result.canceled ||
                result.filePaths.length === 0
            ) {
                return {
                    ok: false,
                    canceled: true,
                    folder: getReportFolder()
                };
            }

            try {
                return {
                    ok: true,
                    folder: setReportFolder(
                        result.filePaths[0]
                    )
                };
            } catch (error) {
                return {
                    ok: false,
                    error:
                        error instanceof Error
                            ? error.message
                            : "Não foi possível configurar a pasta dos relatórios."
                };
            }
        }
    );

    registerTrustedHandle(
        "report:reset-folder",
        async () => ({
            ok: true,
            folder: resetReportFolder()
        })
    );

    registerTrustedHandle(
        "rundown:get",
        async (_event, date) => getDailyRundown(date)
    );

    registerTrustedHandle(
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

    registerTrustedHandle(
        "timeline:list",
        async () => getTimeline()
    );

    registerTrustedHandle(
        "timeline:save",
        async (_event, timelineItems) =>
            saveTimeline(timelineItems)
    );

    registerTrustedOn(
        "ndi:frame",
        (_event, frameData) => {
            if (isTestBench) return;
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

            if (!(frameData instanceof Uint8Array) ||
                frameData.byteLength !== activeOutputProfile.frameSize) return;
            const frameBuffer = Buffer.from(frameData);

            if (
                frameBuffer.length !==
                activeOutputProfile.frameSize
            ) {
                console.warn(
                    `Frame NDI ignorado: ${frameBuffer.length} bytes recebidos, ${activeOutputProfile.frameSize} esperados.`
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

    registerTrustedHandle(
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

    registerTrustedHandle(
        "media:prepare-preview",
        async (_event, requestedPath) => {
            try {
                if (nativePlaybackActive) {
                    throw new Error("Pare o PROGRAM antes de preparar uma previa pesada.");
                }
                if (typeof requestedPath !== "string") {
                    throw new Error("Caminho da midia invalido.");
                }
                const realPath = fs.realpathSync(requestedPath);
                const imported = getMedia().some((item) => {
                    try { return fs.realpathSync(item.path) === realPath; }
                    catch { return false; }
                });
                if (!imported) {
                    throw new Error("A midia precisa estar cadastrada na biblioteca.");
                }
                const proxy = await preparePreviewProxy(
                    realPath,
                    path.join(app.getPath("userData"), "preview-cache"),
                    { ffmpegPath: resolveFfmpegPath() }
                );
                approvedPreviewPaths.add(fs.realpathSync(proxy));
                return { ok: true, filePath: proxy };
            } catch (error) {
                console.error("Falha ao preparar previa:", error);
                return {
                    ok: false,
                    error: error instanceof Error
                        ? error.message : "Nao foi possivel preparar a previa."
                };
            }
        }
    );

    registerTrustedHandle(
        "media:list",
        async () => {
            const media = getMedia();

            const pendingMedia =
                media.filter(
                    (item) =>
                        item.status === "pending-metadata" ||
                        (
                            // Upgrade library items analyzed before we began
                            // persisting stream indexes. If the old metadata
                            // already says there is an audio codec, re-probe
                            // once so future plays can select that track
                            // explicitly instead of relying on 0:a:0.
                            Boolean(item.audioCodec) &&
                            !Number.isSafeInteger(item.audioStreamIndex)
                        )
                );

            if (pendingMedia.length > 0) {
                return analyzeMediaItems(
                    pendingMedia
                );
            }

            return media;
        }
    );

    registerTrustedHandle(
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

    registerTrustedHandle(
        "media:remove",
        async (_event, mediaId) =>
            removeMedia(mediaId)
    );
}

function configuredOutputProfile() {
    const profile = outputProfile(
        getSettings().output
    );

    if (isNdiTestBench) {
        return {
            ...profile,
            ndiEnabled: true,
            sourceName: "Santtos TV - QA"
        };
    }

    return profile;
}

function scheduleNdiRestart() {
    if (ndiStopping || ndiRestartTimer) return;

    const desired = configuredOutputProfile();
    if (!desired.ndiEnabled) return;

    const delay = Math.min(
        30000,
        1000 * 2 ** Math.min(ndiRestartFailures++, 5)
    );

    console.warn(
        `NDI indisponivel; nova tentativa em ${delay} ms.`
    );

    ndiRestartTimer = setTimeout(() => {
        ndiRestartTimer = null;
        startNdiSender();
    }, delay);
}

function startNdiSender() {
    if (ndiProcess || ndiStopping) return;

    const desired = configuredOutputProfile();
    ndiSourceName = desired.sourceName;
    activeOutputProfile = desired;
    activeOutputSignature =
        profileSignature(activeOutputProfile);

    ndiReady = false;
    ndiFrameBusy = false;
    ndiLastError = "";

    if (!desired.ndiEnabled) {
        console.log("NDI desativado nas Configuracoes de Saida.");
        return;
    }

    const ndiExecutable = app.isPackaged
        ? path.join(
              process.resourcesPath,
              "ndi",
              "ndi_test.exe"
          )
        : path.join(
              __dirname,
              "../core/ndi/ndi_test.exe"
          );

    const runtime = checkNdiRuntime({
        requireModern: true,
        executablePath: ndiExecutable,
        dllPath: path.join(
            path.dirname(ndiExecutable),
            "Processing.NDI.Lib.x64.dll"
        )
    });

    if (!runtime.ok) {
        ndiLastError =
            runtime.error ||
            "Runtime NDI com perfil dinamico nao disponivel.";
        console.error(ndiLastError);
        scheduleNdiRestart();
        return;
    }

    ndiAudioSupported = true;
    ndiAudioReady = false;
    ndiAudioNativeActive = false;
    ndiAudioPipe =
        "\\\\.\\pipe\\SanttosAudio-" +
        process.pid +
        "-" +
        crypto.randomBytes(6).toString("hex");

    const nativeArgs = [
        "--name",
        ndiSourceName,
        "--audio-pipe",
        ndiAudioPipe,
        "--width",
        String(desired.width),
        "--height",
        String(desired.height),
        "--fps-n",
        String(desired.fpsN),
        "--fps-d",
        String(desired.fpsD),
        "--scan",
        desired.scanMode,
        "--aspect",
        String(desired.aspect),
        "--pixel-format",
        desired.ndiPixelFormat,
        "--audio-rate",
        String(desired.sampleRate),
        "--audio-channels",
        String(desired.channels)
    ];

    try {
        const processRef = spawn(
            ndiExecutable,
            nativeArgs,
            {
                cwd: path.dirname(ndiExecutable),
                windowsHide: true,
                stdio: ["pipe", "pipe", "pipe"]
            }
        );

        ndiProcess = processRef;
        let pendingOutput = "";

        function onNdiStopped(reason) {
            if (ndiProcess !== processRef) return;

            ndiLastError = reason;
            console.error(
                "Sender NDI interrompido:",
                reason
            );

            stopNativePlayback({
                engineAction: "pause"
            });

            ndiReady = false;
            ndiFrameBusy = false;
            ndiAudioReady = false;
            ndiAudioNativeActive = false;
            ndiAudioPipe = "";
            ndiProcess = null;

            scheduleNdiRestart();
        }

        processRef.stdin.on(
            "error",
            (error) => {
                ndiFrameBusy = false;
                console.error(
                    "Erro no canal de frames NDI:",
                    error
                );
                onNdiStopped(
                    "Erro ao transmitir frames NDI: " +
                        error.message
                );
            }
        );

        processRef.stdout.on(
            "data",
            (data) => {
                pendingOutput += data.toString();
                let newline;

                while (
                    (newline =
                        pendingOutput.indexOf("\n")) >= 0
                ) {
                    const line = pendingOutput
                        .slice(0, newline)
                        .trim();

                    pendingOutput =
                        pendingOutput.slice(
                            newline + 1
                        );

                    if (
                        ndiAudioPipe &&
                        line ===
                            "NDI AUDIO PIPE READY:" +
                                ndiAudioPipe
                    ) {
                        ndiAudioReady = true;
                    }

                    if (
                        line.startsWith(
                            "NDI AUDIO ACTIVE: FLTP "
                        )
                    ) {
                        ndiAudioNativeActive = true;
                    }

                    if (
                        line.startsWith(
                            "NDI ONLINE:"
                        )
                    ) {
                        if (
                            line ===
                            "NDI ONLINE: " +
                                ndiSourceName
                        ) {
                            ndiReady = true;
                            ndiLastError = "";
                            ndiRestartFailures = 0;
                        } else {
                            onNdiStopped(
                                "Nome de fonte NDI inesperado; sender bloqueado."
                            );
                            processRef.kill();
                        }
                    }

                    if (line) {
                        console.log(
                            "[NDI] " +
                                line.slice(0, 1024)
                        );
                    }
                }

                if (pendingOutput.length > 2048) {
                    pendingOutput =
                        pendingOutput.slice(-2048);
                }
            }
        );

        processRef.stderr.on(
            "data",
            (data) => {
                const message =
                    data.toString().trim();

                if (message) {
                    console.error(
                        "[NDI] " +
                            message.slice(0, 2048)
                    );
                }
            }
        );

        processRef.on(
            "error",
            (error) =>
                onNdiStopped(
                    "Nao foi possivel iniciar NDI: " +
                        error.message
                )
        );

        processRef.on(
            "exit",
            (code, signal) =>
                onNdiStopped(
                    `Processo NDI encerrou (codigo ${code}; sinal ${signal}).`
                )
        );
    } catch (error) {
        ndiLastError =
            String(error?.message || error);

        console.error(
            "Erro ao iniciar sender NDI:",
            error
        );

        stopNativePlayback();
        ndiReady = false;
        ndiProcess = null;
        scheduleNdiRestart();
    }
}

function stopNdiSender({
    permanent = true,
    engineAction = "stop"
} = {}) {
    ndiStopping = permanent;

    if (ndiRestartTimer) {
        clearTimeout(ndiRestartTimer);
        ndiRestartTimer = null;
    }

    stopNativePlayback({
        engineAction
    });

    ndiFrameBusy = false;
    ndiReady = false;
    ndiAudioReady = false;
    ndiAudioNativeActive = false;
    ndiAudioPipe = "";

    const processRef = ndiProcess;
    ndiProcess = null;

    if (
        processRef &&
        !processRef.killed
    ) {
        processRef.kill();
    }
}

function restartNdiSenderForProfile() {
    stopNdiSender({
        permanent: false,
        engineAction: "stop"
    });
    ndiStopping = false;
    startNdiSender();
}

function startSystem() {
    console.log(
        "Inicializando Santtos TV Automation..."
    );

    initializeDatabase({
        userDataPath: app.getPath("userData"),
        migrateLegacy: !isTestBench
    });
    initializeLibraryCategories(app.getPath("userData"));
    initializeWebInputs(app.getPath("userData"));
    initializePlayoutReports({
        userDataPath: app.getPath("userData"),
        documentsPath: isTestBench
            ? path.join(testBenchConfig.userDataPath, "documents")
            : app.getPath("documents")
    });
    addLog("Sistema iniciado");

    console.log("Banco de dados OK");
    console.log(
        `Relatórios de exibição: ${getReportFolder()}`
    );
}

// Impede duas instancias de gravarem a mesma grade e disputarem o mesmo sender.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
});

app.whenReady().then(() => {
    if (!hasSingleInstanceLock) return;
    try {
        startSystem();
        protocol.handle(MEDIA_SCHEME, (request) =>
            serveImportedVideo(request, getMedia(), approvedPreviewPaths)
        );
        session.defaultSession.setPermissionRequestHandler(
            (_webContents, _permission, callback) => callback(false)
        );
        if (nativeOutputAllowed) {
            startNdiSender();
        } else {
            ndiLastError = "Bancada: NDI propositalmente desativado.";
        }
        registerIpcHandlers();
        createWindow();
    } catch (error) {
        console.error("Falha fatal ao iniciar o playout:", error);
        dialog.showErrorBox(
            "Santtos TV - inicializacao bloqueada",
            String(error?.message || error)
        );
        app.exit(1);
        return;
    }

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
    cancelActivePreviews();
    closeOpenEntriesAsSkipped();
    stopNativePlayback();
    stopNdiSender();
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
