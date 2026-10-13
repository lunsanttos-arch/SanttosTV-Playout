const {
    app,
    BrowserWindow,
    ipcMain,
    dialog,
    shell,
    nativeImage,
    protocol,
    session
} = require("electron");

const path = require("path");
const fs = require("fs");
const { fileURLToPath } = require("url");
const { MEDIA_SCHEME, serveImportedVideo } = require("../core/media/media-protocol");
const { preparePreviewProxy, cancelActivePreviews } = require("../core/media/preview-proxy");
const {
    INPUT_PREVIEW_SCHEME,
    serveWebInputPreview
} = require("../core/media/web-input-preview");
const {
    isRemoteInputUrl,
    isHlsInput,
    describeRemoteInputError,
    remoteInputArgs
} = require("../core/playout/remote-input");
const {
    resolveRemoteInput
} = require("../core/playout/remote-input-resolver");
const {
    createRemoteHlsProxy
} = require("../core/playout/remote-input-proxy");
const {
    findVlcPath,
    selectInputEngine,
    startVlcInputBridge
} = require("../core/playout/vlc-input-bridge");
const {
    InputPrebufferManager
} = require("../core/playout/input-prebuffer");
const { LABELS, getExhibitionOverlay, buildExhibitionDrawtext } = require("../core/graphics/exhibition-overlay");
const { spawn } = require("child_process");
const { Writable } = require("node:stream");
const crypto = require("node:crypto");
const { checkNdiRuntime } = require("../core/ndi/ndi-capabilities");
const { NdiAudioSource } = require("../core/audio/ndi-audio-source");
const { SchedulingWebController } = require("../core/scheduling/web-controller");
let schedulingController = null;
const { TransportOutput, transportUrl } = require("../core/playout/transport-output");
const transportOutputs = new Map();
const { VideoClockedPcm } = require("../core/audio/video-clocked-pcm");
const { startWarmInputTuner } = require("../core/playout/warm-input-tuner");
const { LiveGraphics } = require("../core/playout/live-graphics");
let activeGraphics = null;
const { InputDeadline } = require("../core/playout/input-deadline");
const { FramePacer } = require("../core/playout/frame-pacer");
const { FixedFrameAssembler } = require("../core/ndi/frame-aligner");
const { OmtOutput } = require("../core/omt/omt-output");
const { ServerMediaManager } = require("../core/media/server-media");
const { NativePlayoutEngine } = require("../core/playout/native-playout-engine");
const { ProgramClock } = require("../core/playout/program-clock");
const { PlayoutRecovery } = require("../core/playout/playout-recovery");
let playoutRecovery = null;
let recoveryTimer = null;
const { JpegFrameParser } = require("../core/playout/program-preview-tap");
const { videoFilterInput } = require("../core/playout/ffmpeg-stream-map");
const {
    outputProfile,
    profileSignature
} = require("../core/playout/output-profile");
const ffmpegStatic = require("ffmpeg-static");
const { configureTestBench } = require("./testbench");

app.commandLine.appendSwitch(
    "autoplay-policy",
    "no-user-gesture-required"
);

if (process.platform === "win32") {
    // Mantém o agrupamento da janela/atalho no Windows e força a identidade
    // do executável empacotado a usar o ícone oficial configurado no build.
    app.setAppUserModelId(
        "com.santtos.tvautomation"
    );
}

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
    resetReportFolder,
    listReportFiles
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
protocol.registerSchemesAsPrivileged([
    {
        scheme: MEDIA_SCHEME,
        privileges: {
            standard: true,
            secure: true,
            stream: true
        }
    },
    {
        scheme: INPUT_PREVIEW_SCHEME,
        privileges: {
            standard: true,
            secure: true,
            stream: true,
            supportFetchAPI: true
        }
    }
]);

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
let omtOutput = null;
let omtRestartTimer = null;
let omtRestartFailures = 0;
let omtStopping = false;
let omtLastError = "";
let serverMediaHealthTimer = null;
let ffmpegProcess = null;
let activeRemoteInputProxy = null;
let activeVlcInputBridge = null;
let activeWarmInputTuner = null;
const inputPrebuffer =
    new InputPrebufferManager({
        resolveRemoteInput,
        createRemoteHlsProxy,
        findVlcPath,
        selectInputEngine,
        startVlcInputBridge,
        startWarmTuner: (url, options) => startWarmInputTuner(url, { ...options, ffmpegPath: resolveFfmpegPath() }),
        ttlMs: 20000
    });

let ndiReady = false;
let ndiDevNullSink = false;
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
let programAudioSequence = 0;
let stopNdiFrameFeed = null;
let stopProgramPreviewFeed = null;
let programPreviewSequence = 0;
let activeOutputProfile = outputProfile({});
let activeOutputSignature = profileSignature(activeOutputProfile);
const programClock = new ProgramClock();
const playoutEngine = new NativePlayoutEngine({
    now: () => programClock.nowMs()
});
const serverMedia = new ServerMediaManager();
function onPlayoutFault(message) {
    for (const output of transportOutputs.values()) output.stop();
    transportOutputs.clear();
    playoutLastError = message;
    nativePlaybackActive = false;
    playoutEngine.fault(message);

    // Em falha inesperada, enviar um frame preto valido ao sender:
    // evita que o ultimo frame do comercial congele sem aviso.
    const blackFrame =
        Buffer.alloc(
            activeOutputProfile.frameSize
        );

    if (
        ndiReady &&
        ndiProcess?.stdin &&
        !ndiProcess.stdin.destroyed
    ) {
        ndiProcess.stdin.write(
            blackFrame,
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

    if (
        omtOutput?.canWriteVideo()
    ) {
        omtOutput.writeVideo(
            blackFrame
        );
    }
}

const analysesInProgress = new Map();
const approvedPreviewPaths = new Set();

function resolveAppIconPath(fileName) {
    return app.isPackaged
        ? path.join(process.resourcesPath, fileName)
        : path.join(__dirname, "../../build-resources", fileName);
}

function resolveAppIcon() {
    // Electron can load PNG consistently for the window; the installer and
    // Windows shell keep the multi-resolution ICO from the same official asset.
    const candidate = resolveAppIconPath("icon.png");
    if (!fs.existsSync(candidate)) return resolveAppIconPath("icon.ico");
    const icon = nativeImage.createFromPath(candidate);
    return icon.isEmpty() ? resolveAppIconPath("icon.ico") : icon;
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1500,
        height: 900,
        minWidth: 1100,
        minHeight: 700,
        backgroundColor: "#0B0B10",
        icon: resolveAppIcon(),
        title: isNdiTestBench ? "SanTTos Playout — TESTE NDI (FONTE QA)"
            : isTestBench ? "SanTTos Playout — BANCADA"
            : "SanTTos Playout",
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

    if (process.platform === "win32") {
        mainWindow.setIcon(resolveAppIcon());
        mainWindow.setAppDetails({
            appId: "com.santtos.tvautomation",
            appIconPath: resolveAppIconPath("icon.ico")
        });
    }

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

const logoAssetCache = new Map();
function logoAsset(style, profile) {
    const blank = () => ({ width: Math.max(1, Math.round(style.widthPx * profile.width / 1920)),
        png: nativeImage.createFromBitmap(Buffer.alloc(16), { width: 2, height: 2 }).toPNG() });
    if (!style.filePath || !fs.existsSync(style.filePath)) return blank();
    const stat = fs.statSync(style.filePath);
    const key = `${style.filePath}:${stat.mtimeMs}:${stat.size}:${style.widthPx}:${profile.width}:${profile.height}`;
    if (logoAssetCache.has(key)) return logoAssetCache.get(key);
    const image = nativeImage.createFromPath(style.filePath);
    if (image.isEmpty()) return blank();
    const size = image.getSize();
    const width = Math.max(1, Math.min(Math.round(style.widthPx * profile.width / 1920),
        profile.width, Math.floor(Math.max(profile.height, 2048) * size.width / size.height)));
    const asset = { width, png: image.resize({ width, quality: "best" }).toPNG() };
    if (logoAssetCache.size >= 8) logoAssetCache.delete(logoAssetCache.keys().next().value);
    logoAssetCache.set(key, asset);
    return asset;
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
        videoFilterInput(
            videoStreamIndex
        );

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
            ? `scale=${targetWidth}:${targetHeight},pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2:black:eval=frame`
            : fitMode === "cover"
              ? `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight},pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2:black:eval=frame`
              : `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:black:eval=frame,pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2:black:eval=frame`;

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
            `scale@program_logo_scale=${state.logoRenderWidth || Math.max(1, Math.round(wm.widthPx * scaleX))}:-1`,
            "format=rgba",
            `colorchannelmixer@program_logo_alpha=aa=${Math.max(
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
            `[${current}][wm]overlay@program_logo=enable=${state.watermarkEnabled ? 1 : 0}:x=${Math.round(
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

    if (text || state.liveGraphicsEnabled) {
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
            state.liveGraphicsEnabled ? "text=' ':expansion=none" : `text='${escapeDrawtextText(text)}'`,
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
            `[${current}]drawtext@program_hashtag=${options.join(":")}[withHashtag]`
        );
        current = "withHashtag";
    }

    if (state.liveGraphicsEnabled || (state.exhibitionType && state.exhibitionType !== "NORMAL")) {
        const graphics = getSettings();
        const identification = buildExhibitionDrawtext(
            current,
            state.exhibitionType && state.exhibitionType !== "NORMAL" ? state.exhibitionType : "ESTREIA",
            graphics.watermarkStyle,
            resolveHashtagFont(graphics.exhibitionStyle)
                .replaceAll("\\\\", "/"),
            { ...graphics.exhibitionStyle, enabled: true },
            {
                width: profile.width,
                height: profile.height
            }
        );
        if (identification) {
            chains.push(state.liveGraphicsEnabled ? identification.replace("drawtext=", "drawtext@program_identification=")
                .replace("[exhibition]", `:enable=${state.exhibitionType && state.exhibitionType !== "NORMAL" && graphics.exhibitionStyle.enabled !== false ? 1 : 0}[exhibition]`) : identification);
            current = "exhibition";
        }
    }

    chains.push(
        `[${current}]split=2[programSource][previewSource]`
    );

    if (profile.scanMode === "interlaced") {
        chains.push(
            `[programSource]tinterlace=mode=interleave_top,format=${profile.ffmpegPixelFormat}[program]`
        );
    } else {
        chains.push(
            `[programSource]format=${profile.ffmpegPixelFormat}[program]`
        );
    }

    const previewFpsExpression =
        profile.fpsN / profile.fpsD > 30
            ? `${profile.fpsN}/${profile.fpsD * 2}`
            : profile.fpsExpression;

    chains.push(
        `[previewSource]scale=640:-2:flags=fast_bilinear,fps=${previewFpsExpression},format=yuvj420p[preview]`
    );

    return chains.join(";");
}

function sendProgramPreviewReset() {
    programPreviewSequence += 1;

    if (
        mainWindow &&
        !mainWindow.isDestroyed()
    ) {
        mainWindow.webContents.send(
            "playout:preview-reset",
            {
                sequence:
                    programPreviewSequence
            }
        );
    }
}

function sendProgramPreviewFrame(
    frame
) {
    if (
        !mainWindow ||
        mainWindow.isDestroyed() ||
        !Buffer.isBuffer(frame) ||
        frame.length === 0
    ) {
        return;
    }

    mainWindow.webContents.send(
        "playout:preview-frame",
        {
            sequence:
                programPreviewSequence,
            mime:
                "image/jpeg",
            data:
                Uint8Array.from(
                    frame
                )
        }
    );
}

function sendProgramAudioReset() {
    programAudioSequence += 1;

    if (
        mainWindow &&
        !mainWindow.isDestroyed()
    ) {
        mainWindow.webContents.send(
            "playout:audio-reset",
            {
                sequence:
                    programAudioSequence
            }
        );
    }
}

function sendProgramAudioPcm(
    chunk,
    sampleRate,
    channels
) {
    if (
        !Buffer.isBuffer(chunk) ||
        chunk.length === 0
    ) {
        return;
    }

    // OMT consome exatamente o mesmo PCM que alimenta o medidor e o NDI.
    // Não existe uma segunda abertura/decodificação da mídia.
    omtOutput?.writeAudio(
        chunk
    );
    for (const output of transportOutputs.values()) output.writeAudio(chunk);

    if (
        !mainWindow ||
        mainWindow.isDestroyed()
    ) {
        return;
    }

    mainWindow.webContents.send(
        "playout:audio-pcm",
        {
            sequence:
                programAudioSequence,
            sampleRate,
            channels,
            data:
                Uint8Array.from(
                    chunk
                )
        }
    );
}

function stopNativePlayback({ engineAction = "stop" } = {}) {
    activeGraphics?.stop(); activeGraphics = null;
    if (engineAction !== "preserve") {
        for (const output of transportOutputs.values()) output.stop();
        transportOutputs.clear();
    }
    activeWarmInputTuner?.stop();
    activeWarmInputTuner = null;
    if (activeVlcInputBridge) {
        activeVlcInputBridge.stop();
        activeVlcInputBridge = null;
    }

    if (activeRemoteInputProxy) {
        activeRemoteInputProxy.close();
        activeRemoteInputProxy = null;
    }

    if (engineAction === "pause") {
        playoutEngine.pause();
    } else if (engineAction === "stop") {
        playoutEngine.stop();
        serverMedia.clearActive();
        serverMedia.setRealtimePriority(
            false
        );
    }

    if (stopNdiFrameFeed) {
        stopNdiFrameFeed();
        stopNdiFrameFeed = null;
    }

    if (stopProgramPreviewFeed) {
        stopProgramPreviewFeed();
        stopProgramPreviewFeed = null;
    }

    if (
        engineAction ===
        "stop"
    ) {
        sendProgramPreviewReset();
    }

    if (audioSource) {
        audioSource.stop();
        audioSource = null;
    }

    sendProgramAudioReset();

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

async function prepareInputPrebuffer(
    filePath,
    overlayState = {}
) {
    const registered =
        getWebInputs().some(
            (item) =>
                item.url === filePath
        );

    if (!registered) {
        throw new Error(
            "O Input deve estar cadastrado antes da pré-carga."
        );
    }

    const status =
        await inputPrebuffer.prepare(
            filePath,
            overlayState
        );

    console.log(
        status?.ready
            ? `Input pré-carregado: ${overlayState.itemId || path.basename(filePath)} | motor=${status.engine}`
            : "Pré-carga do Input descartada."
    );

    return status;
}

function cancelInputPrebuffer() {
    inputPrebuffer.cancel();
    return {
        ok: true,
        ...inputPrebuffer.status()
    };
}

async function startNativePlayback(
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
        isRemoteInputUrl(filePath);
    const isNetworkFile =
        !isRemoteInput &&
        (
            /^\\\\/.test(filePath) ||
            serverMedia.isServerMediaPath(filePath)
        );

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
    } else if (!imported) {
        throw new Error(
            "O arquivo deve estar cadastrado na biblioteca."
        );
    } else if (
        !isNetworkFile &&
        (
            !fs.existsSync(filePath) ||
            !fs.statSync(filePath).isFile()
        )
    ) {
        throw new Error(
            "O arquivo cadastrado não está disponível no disco."
        );
    }

    // Prioridade de tempo real: enquanto um Input Web está no ar, o Playout
    // interrompe cópias/cache SMB e também suspende o health probe do servidor.
    // O FFmpeg/VLC do Input fica sozinho no caminho de rede crítico.
    serverMedia.setRealtimePriority(
        isRemoteInput,
        isRemoteInput
            ? "input-web-on-air"
            : ""
    );

    // UNC/SMB: não fazemos stat/exists síncrono imediatamente antes do PLAY.
    // Se o servidor estiver lento ou reconectando, essas chamadas podem
    // bloquear o processo principal do Electron e atrasar toda a operação.
    // O caminho já foi validado no scanner assíncrono da Biblioteca; no PLAY,
    // o FFmpeg passa a ser a fonte de verdade e reporta falha sem congelar a UI.

    const requestedStartSeconds =
        Number.isFinite(Number(startSeconds))
            ? Math.max(
                  0,
                  Number(startSeconds)
              )
            : 0;

    // PAUSE -> PLAY precisa ser decidido pelo relógio autoritativo do motor,
    // não por um estado React que pode estar até um ciclo de polling atrasado.
    // Se o mesmo item continua pausado, sempre retomamos do timecode salvo no
    // NativePlayoutEngine, mesmo que o renderer envie startSeconds antigo.
    const pausedPlayout =
        playoutEngine.snapshot();
    const requestedItemId =
        typeof overlayState?.itemId === "string"
            ? overlayState.itemId
            : null;
    const samePausedItem =
        pausedPlayout.state === "PAUSED" &&
        pausedPlayout.filePath === filePath &&
        (
            requestedItemId === null ||
            pausedPlayout.itemId === requestedItemId
        );
    const normalizedStartSeconds =
        samePausedItem
            ? pausedPlayout.positionSeconds
            : requestedStartSeconds;

    const transportSettings = getSettings().output;
    for (const kind of ["srt", "rtmp"]) {
        if (transportSettings[kind]?.enabled) transportUrl(transportSettings[kind], kind);
    }
    const desiredOutputs =
        configuredOutputProfile();

    const ndiProgramReady =
        Boolean(
            desiredOutputs.ndiEnabled &&
            ndiReady &&
            ndiProcess?.stdin &&
            !ndiProcess.stdin.destroyed
        );

    const omtProgramReady =
        Boolean(
            desiredOutputs.omtEnabled &&
            omtOutput?.canWriteVideo()
        );

    if (
        !ndiProgramReady &&
        !omtProgramReady &&
        !getSettings().output.srt?.enabled && !getSettings().output.rtmp?.enabled
    ) {
        const details = [
            desiredOutputs.ndiEnabled
                ? ndiLastError || "NDI ainda não está pronto."
                : null,
            desiredOutputs.omtEnabled
                ? omtStatus().error || "OMT ainda não está pronto."
                : null
        ].filter(Boolean);

        throw new Error(
            "Nenhuma saída do PROGRAM está pronta." +
            (
                details.length
                    ? " " + details.join(" ")
                    : " Ative NDI ou OMT nas Configurações de Saída."
            )
        );
    }

    stopNativePlayback({ engineAction: "preserve" });
    playoutLastError = "";

    const ffmpegPath = resolveFfmpegPath();
    const profile = activeOutputProfile;
    const watermarkStyle =
        getSettings().watermarkStyle;
    const watermarkConfigured = Boolean(
        watermarkStyle?.filePath &&
        fs.existsSync(
            watermarkStyle.filePath
        )
    );
    const watermarkEnabled = Boolean(overlayState?.watermarkEnabled && watermarkConfigured);
    const preparedLogo = logoAsset(watermarkStyle, profile);
    const graphics = new LiveGraphics({ hashtag, logoPng: preparedLogo.png });
    graphics.identificationType = overlayState?.exhibitionType || "NORMAL";
    activeGraphics = graphics;
    const programState = {
        ...(overlayState && typeof overlayState === "object"
            ? overlayState
            : {}),
        liveGraphicsEnabled: true,
        logoRenderWidth: preparedLogo.width,
        startSeconds:
            normalizedStartSeconds
    };

    let playbackPath =
        filePath;
    let audioPlaybackPath =
        filePath;
    let serverMediaResolution =
        null;
    let resolvedRemoteInput =
        null;
    let selectedInputEngine =
        "ffmpeg";

    if (isRemoteInput) {
        const warmed =
            samePausedItem
                ? null
                : inputPrebuffer.take(
                      filePath,
                      programState
                  );

        if (warmed) {
            resolvedRemoteInput =
                warmed.resolved;
            selectedInputEngine =
                warmed.engine;
            activeRemoteInputProxy =
                warmed.proxy || null;
            activeVlcInputBridge =
                warmed.vlcBridge || null;
            activeWarmInputTuner = warmed.tuner;
            playbackPath =
                warmed.playbackPath;
            audioPlaybackPath =
                warmed.audioPlaybackPath;

            console.log(
                `Input pré-carregado assumido pelo PROGRAM | motor=${selectedInputEngine}`
            );
        } else {
            // Se a troca chegou antes da pré-carga terminar, invalida o
            // preparo pendente para evitar uma segunda ponte abrindo depois.
            inputPrebuffer.cancel();

            resolvedRemoteInput =
                await resolveRemoteInput(
                    filePath,
                    {
                        userAgent:
                            programState.inputHttpUserAgent,
                        referer:
                            programState.inputHttpReferer
                    }
                );

            playbackPath =
                resolvedRemoteInput.url;
            audioPlaybackPath =
                resolvedRemoteInput.url;

            const vlcPath =
                findVlcPath();

            selectedInputEngine =
                selectInputEngine(
                    programState.inputEngine,
                    resolvedRemoteInput.provider,
                    Boolean(vlcPath)
                );

            const preferredInputEngine =
                String(
                    programState.inputEngine ??
                    "auto"
                ).toLowerCase();

            // Mantém o mesmo motor com ou sem prebuffer. Para HLS em AUTO,
            // o VLC funciona como tuner único e entrega vídeo/áudio na mesma
            // referência de tempo, evitando diferenças de partida entre dois
            // decoders HTTP independentes.
            if (
                preferredInputEngine === "auto" &&
                vlcPath &&
                isHlsInput(
                    resolvedRemoteInput.url,
                    programState.inputProtocol
                )
            ) {
                selectedInputEngine =
                    "vlc";
            }

            let sourceForBridge =
                resolvedRemoteInput.url;

            if (
                resolvedRemoteInput.provider ===
                "dailymotion"
            ) {
                activeRemoteInputProxy =
                    await createRemoteHlsProxy(
                        resolvedRemoteInput
                    );

                sourceForBridge =
                    activeRemoteInputProxy.url;

                console.log(
                    `Input Dailymotion encapsulado pelo proxy local 127.0.0.1:${activeRemoteInputProxy.port}.`
                );
            }

            if (
                selectedInputEngine ===
                "vlc"
            ) {
                try {
                    activeVlcInputBridge =
                        await startVlcInputBridge(
                            sourceForBridge,
                            {
                                vlcPath,
                                userAgent:
                                    resolvedRemoteInput.provider === "dailymotion"
                                        ? ""
                                        : resolvedRemoteInput.userAgent,
                                referer:
                                    resolvedRemoteInput.provider === "dailymotion"
                                        ? ""
                                        : resolvedRemoteInput.referer,
                                withAudioCopy:
                                    true,
                            startTimeSeconds:
                                    samePausedItem
                                        ? normalizedStartSeconds
                                        : 0
                            }
                        );

                    playbackPath =
                        activeVlcInputBridge.videoUrl;
                    audioPlaybackPath =
                        activeVlcInputBridge.audioUrl ||
                        activeVlcInputBridge.videoUrl;

                    console.log(
                        `Input usando ponte VLC: ${path.basename(activeVlcInputBridge.executable)} -> vídeo UDP ${activeVlcInputBridge.videoPort}` +
                        `${activeVlcInputBridge.audioPort ? ` / áudio UDP ${activeVlcInputBridge.audioPort}` : ""}.`
                    );
                } catch (error) {
                    if (
                        (programState.inputEngine ?? "auto") !==
                        "auto"
                    ) {
                        throw error;
                    }

                    selectedInputEngine =
                        "ffmpeg";
                    playbackPath =
                        sourceForBridge;
                    audioPlaybackPath =
                        sourceForBridge;

                    console.warn(
                        "Ponte VLC falhou no modo Automático; usando FFmpeg:",
                        error
                    );
                }
            } else {
                playbackPath =
                    sourceForBridge;
                audioPlaybackPath =
                    sourceForBridge;
            }

            console.log(
                `Input remoto resolvido: ${resolvedRemoteInput.provider}` +
                `${resolvedRemoteInput.providerId ? `/${resolvedRemoteInput.providerId}` : ""}` +
                ` | motor=${selectedInputEngine}`
            );
        }
    } else if (
        serverMedia.isServerMediaPath(
            filePath
        )
    ) {
        serverMediaResolution =
            await serverMedia
                .resolveForPlayback(
                    filePath
                );

        playbackPath =
            serverMediaResolution
                .playbackPath;
        audioPlaybackPath =
            serverMediaResolution
                .playbackPath;

        console.log(
            `Server Media: ${serverMediaResolution.state}` +
            ` | origem=${filePath}` +
            ` | reprodução=${playbackPath}`
        );
    }
    serverMedia.markActive(
        filePath
    );

    const normalizedInPoint =
        Number.isFinite(Number(programState.inPointSeconds))
            ? Math.max(0, Number(programState.inPointSeconds))
            : normalizedStartSeconds;
    const rawOutPoint =
        programState.outPointSeconds;
    const normalizedOutPoint =
        rawOutPoint === null ||
        rawOutPoint === undefined
            ? null
            : Number.isFinite(
                  Number(rawOutPoint)
              )
              ? Math.max(
                    normalizedStartSeconds,
                    Number(rawOutPoint)
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

    const warmedUdp =
        Boolean(
            isRemoteInput &&
            activeVlcInputBridge &&
            /^udp:\/\//i.test(
                playbackPath
            )
        );

    const args = [
        "-hide_banner",
        "-loglevel",
        "warning",
        "-stdin",
        "-fflags",
        "+genpts+discardcorrupt",
        "-err_detect",
        "ignore_err",
        "-probesize",
        isRemoteInput || warmedUdp
            ? "1000000"
            : "10000000",
        "-analyzeduration",
        isRemoteInput || warmedUdp
            ? "500000"
            : "10000000"
    ];

    if (
        normalizedStartSeconds > 0 &&
        (
            !isRemoteInput ||
            samePausedItem
        )
    ) {
        args.push(
            "-ss",
            normalizedStartSeconds.toFixed(3)
        );
    }

    if (
        isRemoteInput &&
        isRemoteInputUrl(playbackPath)
    ) {
        args.push(
            ...remoteInputArgs(
                playbackPath,
                {
                    protocolHint:
                        programState.inputProtocol,
                    userAgent:
                        resolvedRemoteInput?.userAgent ??
                        programState.inputHttpUserAgent,
                    referer:
                        resolvedRemoteInput?.referer ??
                        programState.inputHttpReferer,
                    cookie:
                        resolvedRemoteInput?.cookie ?? "",
                    realtime: true
                }
            )
        );
    }

    if (activeWarmInputTuner) args.push("-live_start_index", "-2");

    args.push(
        "-reinit_filter:v", "0",
        "-i",
        playbackPath
    );

    if (clipRemainingSeconds !== null) {
        args.push(
            "-t",
            clipRemainingSeconds.toFixed(3)
        );
    }

    {
        args.push(
            "-loop",
            "1",
            "-reinit_filter:v", "0",
            "-framerate",
            profile.scanMode === "interlaced"
                ? `${profile.fpsN * 2}/${profile.fpsD}`
                : profile.fpsExpression,
            "-i",
            graphics.logoFile
        );
    }

    args.push(
        "-filter_complex",
        buildProgramFilterGraph(
            hashtag,
            programState,
            true,
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

    if (clipRemainingSeconds !== null) {
        args.push(
            "-t",
            clipRemainingSeconds.toFixed(3)
        );
    }

    args.push(
        "-map",
        "[preview]",
        "-an",
        "-sn",
        "-dn",
        "-c:v",
        "mjpeg",
        "-q:v",
        "5",
        "-f",
        "image2pipe",
        "pipe:3"
    );

    // One demuxer/clock for remote PROGRAM audio and video. Separate HTTP
    // connections can start at different live edges and probe at different speeds.
    const sharedRemoteAudio = isRemoteInput && programState.__inputVideoOnly !== true;
    if (sharedRemoteAudio) {
        args.push(
            "-map", Number.isSafeInteger(programState.audioStreamIndex) && programState.audioStreamIndex >= 0
                ? `0:${programState.audioStreamIndex}?` : "0:a:0?",
            "-vn", "-sn", "-dn",
            "-af", "aresample=async=1:first_pts=0",
            "-ac", String(profile.channels), "-ar", String(profile.sampleRate),
            "-c:a", "pcm_f32le", "-f", "f32le"
        );
        if (clipRemainingSeconds !== null) args.push("-t", clipRemainingSeconds.toFixed(3));
        args.push("pipe:4");
    }

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
                "pipe",
                "pipe",
                "pipe",
                "pipe",
                "pipe"
            ]
        }
    );

    graphics.attach(processRef);
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
        outPointSeconds: normalizedOutPoint,
        waitForFirstFrame: isRemoteInput
    });

    const configuredTransports = getSettings().output;
    for (const kind of ["srt", "rtmp"]) {
        const settings = configuredTransports[kind];
        const signature = JSON.stringify([profile.width, profile.height, profile.fpsExpression,
            profile.ffmpegPixelFormat, profile.sampleRate, profile.channels, settings]);
        const current = transportOutputs.get(kind);
        if (settings?.enabled && current?.process && current.signature === signature) continue;
        current?.stop(); transportOutputs.delete(kind);
        if (!settings?.enabled) continue;
        try {
            const output = new TransportOutput({ ffmpegPath, profile, settings, kind,
                onError: error => {
                    console.error(`[${kind.toUpperCase()}] ${error}`);
                    playoutLastError = `Saída ${kind.toUpperCase()}: ${error}`;
                } }).start();
            output.signature = signature;
            transportOutputs.set(kind, output);
        } catch (error) { console.error(`Saída ${kind.toUpperCase()}:`, error.message); }
    }
    const selectedAudioIndex = programState.audioStreamIndex;
    const sharedAudioClock = sharedRemoteAudio
        ? new VideoClockedPcm(processRef.stdio[4], profile) : null;

    try {
        const routedPipe =
            ndiAudioSupported &&
            ndiAudioReady &&
            ndiAudioPipe
                ? ndiAudioPipe
                : "";

        audioSource = new NdiAudioSource({
            pcmStream: sharedAudioClock?.output ?? null,
            pipePath:
                routedPipe,
            ffmpegPath,
            filePath:
                audioPlaybackPath,
            // O mesmo PCM alimenta o medidor, o monitor local e, quando
            // disponível, o pipe NDI. Assim o operador ouve e mede exatamente
            // a fonte que o PROGRAM está usando.
            streamIndex: Number.isSafeInteger(selectedAudioIndex) &&
                selectedAudioIndex >= 0
                    ? selectedAudioIndex
                    : null,
            startSeconds:
                activeVlcInputBridge
                    ? 0
                    : normalizedStartSeconds,
            durationSeconds: clipRemainingSeconds,
            sampleRate: profile.sampleRate,
            channels: profile.channels,
            protocolHint:
                activeVlcInputBridge
                    ? ""
                    : programState.inputProtocol ?? "",
            userAgent:
                activeVlcInputBridge
                    ? ""
                    : resolvedRemoteInput?.userAgent ??
                      programState.inputHttpUserAgent ??
                      "",
            referer:
                activeVlcInputBridge
                    ? ""
                    : resolvedRemoteInput?.referer ??
                      programState.inputHttpReferer ??
                      "",
            cookie:
                activeVlcInputBridge
                    ? ""
                    : resolvedRemoteInput?.cookie ?? "",
            seekRemote:
                Boolean(
                    samePausedItem &&
                    !activeVlcInputBridge
                ),
            onPcmData:
                sendProgramAudioPcm
        }).start();

        audioOutputStatus = "STARTING";
        audioOutputError =
            routedPipe
                ? ""
                : ndiDevNullSink
                  ? "Monitor local do PROGRAM ativo; NDI real indisponível neste PC."
                  : "Monitor local do PROGRAM ativo; aguardando rota NDI.";
    } catch (error) {
        audioOutputStatus = "ERROR";
        audioOutputError = String(error?.message || error);
        console.error(
            "Falha ao iniciar áudio do PROGRAM:",
            error
        );
    }

    // rawvideo is a byte stream without delimiters. Never pipe it
    // directly into the persistent NDI sender: stopping/seeking FFmpeg can
    // leave a partial frame in stdin and the next clip would complete it,
    // producing a picture made from two different frames.
    let feedActive = true;
    let firstProgramFrame = true;
    let inputDeadline = null;
    let clipFinished = false;
    let pacer = null;
    let deliveredFrames = 0;
    let decodedPreviewFrames = 0;
    const pendingPreviewFrames = [];
    const previewRatio = profile.fpsN / profile.fpsD > 30 ? 2 : 1;
    const flushPacedPreview = () => {
        let latest = null;
        const allowed = Math.ceil(deliveredFrames / previewRatio);
        while (pendingPreviewFrames.length && pendingPreviewFrames[0].index <= allowed) {
            latest = pendingPreviewFrames.shift().frame;
        }
        if (latest) sendProgramPreviewFrame(latest);
    };
    const deliverFrame = (completeFrame) => {
            if (
                !feedActive ||
                ffmpegProcess !== processRef
            ) {
                return;
            }

            if (firstProgramFrame) {
                firstProgramFrame = false;
                playoutEngine.markReady();
                inputDeadline?.start();
                settleStartupSuccess();
            }

            const drains = [];

            const ndiFrameReady =
                Boolean(
                    ndiReady &&
                    ndiProcess?.stdin &&
                    !ndiProcess.stdin.destroyed
                );

            if (ndiFrameReady) {
                const ndiTarget =
                    ndiProcess.stdin;

                const ndiCanContinue =
                    ndiTarget.write(
                        completeFrame
                    );

                if (!ndiCanContinue) {
                    drains.push(
                        (done) => {
                            if (
                                ndiTarget.destroyed
                            ) {
                                queueMicrotask(
                                    done
                                );
                                return;
                            }

                            ndiTarget.once(
                                "drain",
                                done
                            );
                        }
                    );
                }
            }

            if (
                omtOutput?.canWriteVideo()
            ) {
                // Com NDI ativo, OMT é uma saída auxiliar e pode descartar
                // quadros próprios sob pressão sem tocar no ritmo do PROGRAM.
                // Em OMT-only, o sender assume o pacing do decoder.
                const omtCanContinue =
                    omtOutput.writeVideo(
                        completeFrame,
                        {
                            allowDrop:
                                ndiFrameReady ||
                                isRemoteInput
                        }
                    );

                if (
                    !ndiFrameReady &&
                    !isRemoteInput &&
                    !omtCanContinue
                ) {
                    const omtTarget =
                        omtOutput;

                    drains.push(
                        (done) =>
                            omtTarget.onceVideoDrain(
                                done
                            )
                    );
                }
            }

            for (const output of transportOutputs.values()) output.writeVideo(completeFrame);
            sharedAudioClock?.advance();
            deliveredFrames += 1;
            if (pacer) flushPacedPreview();
            if (
                drains.length > 0 &&
                processRef.stdout &&
                !processRef.stdout.destroyed
            ) {
                processRef.stdout.pause();

                let waiting =
                    drains.length;

                const onDrain = () => {
                    waiting -= 1;

                    if (
                        waiting === 0 &&
                        feedActive &&
                        ffmpegProcess === processRef &&
                        processRef.stdout &&
                        !processRef.stdout.destroyed
                    ) {
                        if (pacer) pacer.resume();
                        else processRef.stdout.resume();
                    }
                };

                for (
                    const waitForDrain
                    of drains
                ) {
                    waitForDrain(
                        onDrain
                    );
                }
            }
            return drains.length === 0;
    };
    if (sharedRemoteAudio) pacer = new FramePacer({ profile, source: processRef.stdout, onFrame: deliverFrame });
    const assembler = new FixedFrameAssembler(profile.frameSize, frame => {
        if (pacer) pacer.push(frame); else deliverFrame(frame);
    });

    let startupStderr = "";
    let startupSettled = !isRemoteInput;
    let resolveStartup;
    let rejectStartup;

    const startupPromise =
        isRemoteInput
            ? new Promise((resolve, reject) => {
                  resolveStartup = resolve;
                  rejectStartup = reject;
              })
            : Promise.resolve();

    const settleStartupSuccess = () => {
        if (startupSettled) return;
        startupSettled = true;
        resolveStartup?.();
    };

    const settleStartupFailure = (message) => {
        if (startupSettled) return;
        startupSettled = true;
        rejectStartup?.(
            new Error(
                message ||
                    "O Input não entregou vídeo."
            )
        );
    };

    const onVideoBytes = (chunk) => {
        assembler.push(chunk);
    };
    processRef.stdout.on("data", onVideoBytes);

    const previewPipe =
        processRef.stdio[3];
    const previewParser =
        new JpegFrameParser(
            (frame) => {
                if (
                    ffmpegProcess !==
                    processRef
                ) {
                    return;
                }

                if (pacer) {
                    pendingPreviewFrames.push({ frame, index: ++decodedPreviewFrames });
                    if (pendingPreviewFrames.length > 120) pendingPreviewFrames.shift();
                    flushPacedPreview();
                } else sendProgramPreviewFrame(frame);
            }
        );

    const onPreviewBytes =
        (chunk) =>
            previewParser.write(
                chunk
            );

    if (previewPipe) {
        previewPipe.on(
            "data",
            onPreviewBytes
        );
    }

    const stopThisPreviewFeed = () => {
        if (previewPipe) {
            previewPipe.off(
                "data",
                onPreviewBytes
            );
        }

        previewParser.reset();
        pendingPreviewFrames.length = 0;
        previewPipe?.resume();
    };

    stopProgramPreviewFeed =
        stopThisPreviewFeed;

    const stopThisFeed = () => {
        if (!feedActive) return;
        feedActive = false;
        inputDeadline?.stop();
        pacer?.stop();
        sharedAudioClock?.stop();
        processRef.stdout.off("data", onVideoBytes);
        processRef.stdout.resume();
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
                startupStderr =
                    (startupStderr +
                        "\n" +
                        message)
                        .slice(-1800);
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

            settleStartupFailure(
                "Erro ao abrir o Input no FFmpeg: " +
                    error.message
            );

            if (ffmpegProcess === processRef) {
                activeWarmInputTuner?.stop();
                activeWarmInputTuner = null;
                ffmpegProcess = null;

                if (activeVlcInputBridge) {
                    activeVlcInputBridge.stop();
                    activeVlcInputBridge = null;
                }

                if (activeRemoteInputProxy) {
                    activeRemoteInputProxy.close();
                    activeRemoteInputProxy = null;
                }

                onPlayoutFault("Erro no decodificador FFmpeg: " + error.message);

                if (isRemoteInput) {
                    serverMedia.setRealtimePriority(
                        false
                    );
                }
            }
        }
    );

    const finishClip = (code, signal, atScheduledOut = false) => {
        if (clipFinished) return;
        clipFinished = true;
        graphics.stop();
        if (activeGraphics === graphics) activeGraphics = null;
        stopThisFeed();

        if (
            stopProgramPreviewFeed ===
            stopThisPreviewFeed
        ) {
            stopThisPreviewFeed();
            stopProgramPreviewFeed = null;
        }

        if (stopNdiFrameFeed === stopThisFeed) {
            stopNdiFrameFeed = null;
        }

        console.log(atScheduledOut
            ? "Input concluído no OUT; liberando decoder."
            : `Playout FFmpeg encerrado. Código: ${code}, sinal: ${signal}`);


        if (!startupSettled) {
            const friendlyError =
                describeRemoteInputError(
                    startupStderr
                );

            settleStartupFailure(
                [
                    code === 0 && !signal
                        ? "O Input terminou antes de entregar o primeiro quadro."
                        : "O FFmpeg não conseguiu abrir o Input.",
                    friendlyError ||
                        startupStderr
                ]
                    .filter(Boolean)
                    .join("\n")
                    .slice(-1200)
            );
        }

        if (ffmpegProcess === processRef) {
            activeWarmInputTuner?.stop();
            activeWarmInputTuner = null;
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
                const detail =
                    describeRemoteInputError(
                        startupStderr
                    );

                onPlayoutFault(
                    [
                        `O FFmpeg parou durante o programa (codigo ${code}; sinal ${signal || "-"}).`,
                        detail
                    ]
                        .filter(Boolean)
                        .join("\n")
                        .slice(-1400)
                );
            }

            if (activeVlcInputBridge) {
                activeVlcInputBridge.stop();
                activeVlcInputBridge = null;
            }

            if (activeRemoteInputProxy) {
                activeRemoteInputProxy.close();
                activeRemoteInputProxy = null;
            }

            if (isRemoteInput) {
                serverMedia.setRealtimePriority(
                    false
                );
            }
        }
    };

    if (isRemoteInput && clipRemainingSeconds !== null) {
        inputDeadline = new InputDeadline(clipRemainingSeconds, () => {
            if (ffmpegProcess !== processRef || !feedActive) return;
            console.log(`Input atingiu OUT programado: ${programState.itemId || "input"}`);
            // Detach this occurrence before notifying the renderer. Its late
            // close/drain callbacks must never stop the next decoder/audio feed.
            finishClip(0, null, true);
            processRef.stdout.resume();
            processRef.stdio[4]?.resume();
            processRef.kill();
            const killTimer = setTimeout(() => {
                if (processRef.exitCode === null && processRef.signalCode === null) processRef.kill("SIGKILL");
            }, 1000);
            killTimer.unref();
            processRef.once("close", () => clearTimeout(killTimer));
        });
    }
    processRef.on("close", async (code, signal) => {
        if (clipFinished) return;
        if (code === 0 && !signal && ffmpegProcess === processRef) await pacer?.end();
        finishClip(code, signal);
    });

    if (isRemoteInput) {
        let timeout;

        try {
            await Promise.race([
                startupPromise,
                new Promise((_, reject) => {
                    timeout = setTimeout(
                        () =>
                            reject(
                                new Error(
                                    [
                                        "O Input não entregou o primeiro quadro em 12 segundos. Verifique a URL, autenticação, rede ou codec.",
                                        activeVlcInputBridge?.stderr?.()
                                            ? "VLC: " + activeVlcInputBridge.stderr()
                                            : ""
                                    ]
                                        .filter(Boolean)
                                        .join("\n")
                                        .slice(-1400)
                                )
                            ),
                        12000
                    );
                })
            ]);
        } catch (error) {
            if (sharedRemoteAudio && /does not contain any stream|matches no streams/i.test(startupStderr)) {
                stopNativePlayback();
                return startNativePlayback(filePath, normalizedStartSeconds, hashtag, {
                    ...programState, __inputVideoOnly: true
                });
            }
            const canFallbackToDirectFfmpeg =
                selectedInputEngine === "vlc" &&
                String(
                    programState.inputEngine ??
                    "auto"
                ).toLowerCase() === "auto" &&
                programState.__inputFallbackAttempted !== true;

            if (canFallbackToDirectFfmpeg) {
                console.warn(
                    "Ponte VLC não entregou o primeiro quadro; tentando FFmpeg direto automaticamente."
                );

                if (
                    ffmpegProcess ===
                    processRef
                ) {
                    ffmpegProcess =
                        null;
                }

                nativePlaybackActive =
                    false;

                if (audioSource) {
                    audioSource.stop();
                    audioSource =
                        null;
                }

                if (
                    activeVlcInputBridge
                ) {
                    activeVlcInputBridge.stop();
                    activeVlcInputBridge =
                        null;
                }

                if (
                    activeRemoteInputProxy
                ) {
                    activeRemoteInputProxy.close();
                    activeRemoteInputProxy =
                        null;
                }

                try {
                    if (!processRef.killed) {
                        processRef.kill();
                    }
                } catch {
                    // Processo já encerrado.
                }

                return startNativePlayback(
                    filePath,
                    normalizedStartSeconds,
                    hashtag,
                    {
                        ...programState,
                        inputEngine:
                            "ffmpeg",
                        __inputFallbackAttempted:
                            true
                    }
                );
            }

            try {
                if (!processRef.killed) {
                    processRef.kill();
                }
            } catch {
                // Processo já encerrado.
            }

            if (ffmpegProcess === processRef) {
                stopNativePlayback({ engineAction: "preserve" });
                onPlayoutFault(error.message || "O Input não entregou vídeo.");
            }
            throw error;
        } finally {
            if (timeout) {
                clearTimeout(timeout);
            }
        }
    }

    return {
        ok: true,
        filePath,
        startSeconds:
            normalizedStartSeconds,
        playout:
            playoutEngine.snapshot()
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

function refreshHashtagGraphics() {
    if (!activeGraphics) return;
    const style = getSettings().hashtagStyle;
    const sx = activeOutputProfile.width / 1920, sy = activeOutputProfile.height / 1080;
    activeGraphics.style({ fontfile: `'${resolveHashtagFont(style).replace('\\:', ':')}'`, x: Math.round(style.x * sx), y: Math.round(style.y * sy),
        fontsize: Math.max(1, Math.round(style.fontSize * Math.min(sx, sy))),
        fontcolor: toFfmpegColor(style.color, style.opacity),
        borderw: Math.round(style.outlineWidth * Math.min(sx, sy)),
        bordercolor: toFfmpegColor(style.outlineColor, style.outlineOpacity),
        shadowcolor: toFfmpegColor(style.shadowColor, style.shadowEnabled ? style.shadowOpacity : 0),
        shadowx: Math.round(style.shadowX * sx), shadowy: Math.round(style.shadowY * sy) });
}

function refreshIdentificationGraphics() {
    if (!activeGraphics) return;
    const { exhibitionStyle: style, watermarkStyle: wm } = getSettings();
    const profile = activeOutputProfile;
    const overlay = getExhibitionOverlay("ESTREIA", wm, { ...style, enabled: true }, { width: profile.width, height: profile.height });
    if (!overlay) return;
    const scale = Math.min(profile.width / 1920, profile.height / 1080);
    activeGraphics.style({ fontfile: `'${resolveHashtagFont(style).replace("\\:", ":")}'`,
        fontsize: overlay.fontSize, fontcolor: toFfmpegColor(style.color, style.opacity),
        borderw: Math.round(style.outlineWidth * scale), bordercolor: toFfmpegColor(style.outlineColor, style.outlineOpacity),
        x: `'max(8,min(w-text_w-8,${overlay.center}-text_w/2))'`, y: overlay.top,
        box: style.backgroundEnabled ? 1 : 0, boxcolor: toFfmpegColor(style.backgroundColor, style.backgroundOpacity),
        boxborderw: overlay.padding, shadowcolor: toFfmpegColor(style.shadowColor, style.shadowEnabled ? style.shadowOpacity : 0),
        shadowx: Math.round(style.shadowX * scale), shadowy: Math.round(style.shadowY * scale) }, "drawtext@program_identification");
    activeGraphics.command("drawtext@program_identification", "enable", style.enabled !== false && LABELS[activeGraphics.identificationType] ? "1" : "0");
}

function registerIpcHandlers() {
    registerTrustedHandle("playout:graphics", async (_event, update) => {
        const snapshot = playoutEngine.snapshot();
        if (!activeGraphics || !ffmpegProcess || update?.itemId !== snapshot.itemId)
            return { ok: false, stale: true };
        try {
            if (typeof update.watermark === "boolean") activeGraphics.logo(update.watermark);
            if (typeof update.hashtag === "string") activeGraphics.text(update.hashtag);
            if (typeof update.exhibitionType === "string") {
                activeGraphics.identificationType = LABELS[update.exhibitionType] ? update.exhibitionType : "NORMAL";
                const text = LABELS[update.exhibitionType] || "";
                activeGraphics.command("drawtext@program_identification", "text", text || " ");
                activeGraphics.command("drawtext@program_identification", "enable", text && getSettings().exhibitionStyle.enabled !== false ? "1" : "0");
            }
            if (update.refreshStyle === true) refreshHashtagGraphics();
            return { ok: true, generation: snapshot.generation };
        } catch (error) { return { ok: false, error: error.message }; }
    });

    registerTrustedHandle("controller:status", async () => schedulingController.status());
    registerTrustedHandle("controller:set-enabled", async (_event, enabled) => {
        if (enabled === true) return schedulingController.start();
        schedulingController.stop(); return schedulingController.status();
    });

    registerTrustedHandle("playout:recovery", async () => playoutRecovery?.state ?? null);
    registerTrustedHandle("playout:checkpoint", async (_event, checkpoint) => {
        if (!getTimeline().some((item) => item.id === checkpoint?.itemId)) return { ok: false };
        const native = playoutEngine.snapshot();
        playoutRecovery.save(nativeOutputAllowed && native.itemId === checkpoint.itemId &&
            ["PLAYING", "PAUSED", "STARTING"].includes(native.state)
            ? { itemId: native.itemId, positionSeconds: native.positionSeconds, playing: native.state !== "PAUSED" }
            : checkpoint);
        return { ok: true };
    });
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
                    receiverVerified: false, routedToNdi: false, route: ndiSourceName },
            nativePlaybackActive,
            programClock: programClock.snapshot(),
            omt: omtStatus(),
            graphics: activeGraphics?.snapshot() ?? null,
            transports: Object.fromEntries([...transportOutputs].map(([kind, output]) => [kind, { online: output.online, error: output.error }])),
            playout: playoutEngine.snapshot(),
            playoutError: playoutLastError || null,
            error: ndiLastError || null,
            devNullSink: ndiDevNullSink,
            preparedInput:
                inputPrebuffer.status(),
            serverMedia:
                serverMedia.status(),
            restarting: Boolean(ndiRestartTimer),
            testBench: isTestBench
        })
    );

    registerTrustedHandle(
        "ndi:prepare-input",
        async (
            _event,
            filePath,
            overlayState = {}
        ) => {
            if (!nativeOutputAllowed) {
                return {
                    ok: true,
                    previewOnly: true
                };
            }

            try {
                const status =
                    await prepareInputPrebuffer(
                        filePath,
                        overlayState
                    );

                return {
                    ok: true,
                    ...status
                };
            } catch (error) {
                console.error(
                    "Pré-carga do Input falhou:",
                    error
                );

                return {
                    ok: false,
                    error:
                        error?.message ||
                        String(error)
                };
            }
        }
    );

    registerTrustedHandle(
        "ndi:cancel-prepared-input",
        async () =>
            cancelInputPrebuffer()
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
                return await startNativePlayback(
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
        "server-media:get-settings",
        async () => ({
            ok: true,
            settings:
                serverMedia.getSettings(),
            status:
                serverMedia.status()
        })
    );

    registerTrustedHandle(
        "server-media:set-settings",
        async (_event, value) => {
            try {
                const settings =
                    serverMedia.updateSettings(
                        value
                    );

                const status =
                    await serverMedia
                        .probeRoot();

                return {
                    ok: true,
                    settings,
                    status
                };
            } catch (error) {
                return {
                    ok: false,
                    error:
                        error instanceof Error
                            ? error.message
                            : String(error)
                };
            }
        }
    );

    registerTrustedHandle(
        "server-media:select-root",
        async () => {
            const result =
                await dialog.showOpenDialog(
                    mainWindow ?? undefined,
                    {
                        title:
                            "Selecionar raiz do servidor de mídia",
                        properties: [
                            "openDirectory"
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

            return {
                ok: true,
                folderPath:
                    result.filePaths[0]
            };
        }
    );

    registerTrustedHandle(
        "server-media:prepare",
        async (_event, filePath) => {
            try {
                const result =
                    await serverMedia.prepare(
                        filePath
                    );

                return {
                    ok: true,
                    ...result,
                    status:
                        serverMedia.status()
                };
            } catch (error) {
                return {
                    ok: false,
                    error:
                        error instanceof Error
                            ? error.message
                            : String(error),
                    status:
                        serverMedia.status()
                };
            }
        }
    );

    registerTrustedHandle(
        "server-media:clear-cache",
        async () => {
            try {
                const engineState =
                    playoutEngine.snapshot().state;

                if (
                    engineState === "PLAYING" || engineState === "STARTING" ||
                    engineState === "PAUSED"
                ) {
                    return {
                        ok: false,
                        error:
                            "Pare o PROGRAM antes de limpar o cache do servidor."
                    };
                }

                return {
                    ok: true,
                    status:
                        await serverMedia
                            .clearCache()
                };
            } catch (error) {
                return {
                    ok: false,
                    error:
                        error instanceof Error
                            ? error.message
                            : String(error)
                };
            }
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
        "web-inputs:vlc-status",
        async () => {
            const vlcPath =
                findVlcPath();

            return {
                ok: true,
                available:
                    Boolean(vlcPath),
                path:
                    vlcPath || ""
            };
        }
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
                    engineState === "PLAYING" || engineState === "STARTING" ||
                    engineState === "PAUSED"
                ) {
                    return {
                        ok: false,
                        error:
                            "Pare o PROGRAM antes de alterar o perfil técnico das saídas."
                    };
                }

                const saved =
                    updateOutputSettings(output);

                // O sender carrega resolução/FPS/scan/pixel/audio/nome
                // na inicialização. Aplicar o perfil salvo imediatamente.
                if (nativeOutputAllowed) {
                    restartNdiSenderForProfile();
                    restartOmtSenderForProfile();
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
        async (_event, style) => {
            const hashtagStyle = updateHashtagStyle(style);
            refreshHashtagGraphics();
            return { ok: true, hashtagStyle };
        }
    );

    registerTrustedHandle(
        "settings:set-exhibition-style",
        async (_event, style) => {
            const exhibitionStyle = updateExhibitionStyle(style);
            refreshIdentificationGraphics();
            return { ok: true, exhibitionStyle };
        }
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
                    watermarkStyle: (() => {
                        const saved = updateWatermarkStyle(style);
                        if (activeGraphics) {
                            const asset = logoAsset(saved, activeOutputProfile);
                            activeGraphics.image(asset.png);
                            activeGraphics.command("overlay@program_logo", "x", String(Math.round(saved.x * activeOutputProfile.width / 1920)));
                            activeGraphics.command("overlay@program_logo", "y", String(Math.round(saved.y * activeOutputProfile.height / 1080)));
                            activeGraphics.command("scale@program_logo_scale", "w", String(asset.width));
                            activeGraphics.command("colorchannelmixer@program_logo_alpha", "aa", String(saved.opacity));
                        }
                        refreshIdentificationGraphics();
                        return saved;
                    })()
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

    registerTrustedHandle("report:list", async () => ({ ok: true, files: await listReportFiles() }));
    registerTrustedHandle("report:open", async (_event, date) => {
        const target = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
            ? path.join(getReportFolder(), `Relatorio_Exibicao_${date}.html`) : getReportFolder();
        const error = await shell.openPath(target);
        return { ok: !error, error: error || null };
    });
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

function resolveOmtRuntimeFolder() {
    return app.isPackaged
        ? path.join(
              process.resourcesPath,
              "omt"
          )
        : path.join(
              __dirname,
              "../core/omt"
          );
}

function omtStatus() {
    const profile =
        configuredOutputProfile();

    const snapshot =
        omtOutput?.snapshot();

    return snapshot ?? {
        enabled:
            Boolean(
                profile.omtEnabled
            ),
        online: false,
        source:
            profile.omtName,
        quality:
            profile.omtQuality,
        audioReady: false,
        audioActive: false,
        connectedAudio: false,
        videoFrames: 0,
        audioBytes: 0,
        error:
            omtLastError ||
            null
    };
}

function scheduleOmtRestart() {
    if (
        omtStopping ||
        omtRestartTimer ||
        !nativeOutputAllowed
    ) {
        return;
    }

    const desired =
        configuredOutputProfile();

    if (!desired.omtEnabled) {
        return;
    }

    const delay =
        Math.min(
            30000,
            1000 *
                2 **
                    Math.min(
                        omtRestartFailures++,
                        5
                    )
        );

    console.warn(
        `OMT indisponível; nova tentativa em ${delay} ms.`
    );

    omtRestartTimer =
        setTimeout(
            () => {
                omtRestartTimer =
                    null;

                startOmtSender();
            },
            delay
        );
}

function startOmtSender() {
    if (
        omtOutput ||
        omtStopping ||
        !nativeOutputAllowed
    ) {
        return;
    }

    const desired =
        configuredOutputProfile();

    if (!desired.omtEnabled) {
        omtLastError = "";
        return;
    }

    let instance = null;

    instance =
        new OmtOutput({
            runtimeFolder:
                resolveOmtRuntimeFolder(),
            profile:
                desired,
            onUnexpectedExit:
                (reason) => {
                    if (
                        omtOutput !==
                        instance
                    ) {
                        return;
                    }

                    omtLastError =
                        reason;

                    omtOutput =
                        null;

                    scheduleOmtRestart();
                }
        });

    omtOutput =
        instance;

    try {
        instance.start();
        omtLastError = "";
        omtRestartFailures = 0;
    } catch (error) {
        omtOutput = null;

        omtLastError =
            error instanceof Error
                ? error.message
                : String(error);

        console.error(
            "Falha ao iniciar sender OMT:",
            error
        );

        scheduleOmtRestart();
    }
}

function stopOmtSender({
    permanent = true
} = {}) {
    omtStopping =
        permanent;

    if (omtRestartTimer) {
        clearTimeout(
            omtRestartTimer
        );

        omtRestartTimer =
            null;
    }

    const instance =
        omtOutput;

    omtOutput = null;

    if (instance) {
        instance.stop();
    }

    if (permanent) {
        omtLastError = "";
    }
}

function restartOmtSenderForProfile() {
    stopOmtSender({
        permanent: false
    });

    omtStopping = false;
    startOmtSender();
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

        if (
            isDevelopment &&
            !isNdiTestBench
        ) {
            const sink =
                new Writable({
                    write(
                        _chunk,
                        _encoding,
                        callback
                    ) {
                        callback();
                    }
                });

            const processRef = {
                stdin: sink,
                killed: false,
                kill() {
                    if (this.killed) return;
                    this.killed = true;
                    try {
                        sink.end();
                    } catch {
                        // Sink ja encerrado.
                    }
                }
            };

            ndiProcess = processRef;
            ndiReady = true;
            ndiDevNullSink = true;
            ndiAudioSupported = false;
            ndiAudioReady = false;
            ndiAudioNativeActive = false;
            ndiAudioPipe = "";
            ndiRestartFailures = 0;

            console.warn(
                "NDI nativo indisponivel; DEV NULL SINK ativo. PROGRAM/VLC/Inputs podem ser testados sem saida NDI real."
            );

            return;
        }

        console.error(ndiLastError);
        scheduleNdiRestart();
        return;
    }

    ndiDevNullSink = false;
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
    ndiDevNullSink = false;
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

function stopServerMediaHealthMonitor() {
    if (
        serverMediaHealthTimer
    ) {
        clearInterval(
            serverMediaHealthTimer
        );

        serverMediaHealthTimer =
            null;
    }
}

function startServerMediaHealthMonitor() {
    stopServerMediaHealthMonitor();

    const inspected = new Map();
    let caching = false;
    const cacheLibrary = async () => {
        if (caching || nativePlaybackActive || serverMedia.status().activeJobs > 0) return;
        const candidate = getMedia().find(item => {
            if (!item.path || !serverMedia.isServerMediaPath(item.path)) return false;
            const signature = `${item.duration}:${item.updatedAt ?? ""}:${item.fileSize ?? ""}`;
            return inspected.get(item.path) !== signature;
        });
        if (!candidate) return;
        inspected.set(candidate.path, `${candidate.duration}:${candidate.updatedAt ?? ""}:${candidate.fileSize ?? ""}`);
        caching = true;
        try { await serverMedia.prepare(candidate.path); }
        catch (error) { console.warn("Cache automático:", error.message); }
        finally { caching = false; }
    };
    const probe = () => {
        void cacheLibrary();
        void serverMedia
            .probeRoot()
            .catch((error) =>
                console.warn(
                    "Teste de disponibilidade do servidor de mídia falhou:",
                    error
                )
            );
    };

    probe();

    serverMediaHealthTimer =
        setInterval(
            probe,
            10000
        );
}

function startSystem() {
    console.log(
        "Inicializando Santtos TV Automation..."
    );

    initializeDatabase({
        userDataPath: app.getPath("userData"),
        migrateLegacy: !isTestBench
    });
    schedulingController = new SchedulingWebController({ distFolder: path.join(__dirname, "../../dist"),
        getMedia, getCategories: getLibraryCategories, getRundown: getDailyRundown, saveRundown: saveDailyRundown });
    playoutRecovery = new PlayoutRecovery(app.getPath("userData"));
    recoveryTimer = setInterval(() => {
        try { playoutRecovery.captureNative(playoutEngine.snapshot()); }
        catch (error) { console.error("Falha ao salvar recuperação do PROGRAM:", error); }
    }, 1000);
    serverMedia.initialize(
        app.getPath("userData"),
        app.getPath("cache")
    );
    startServerMediaHealthMonitor();
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
        protocol.handle(INPUT_PREVIEW_SCHEME, (request) =>
            serveWebInputPreview(
                request,
                getWebInputs(),
                {
                    ffmpegPath:
                        resolveFfmpegPath()
                }
            )
        );
        session.defaultSession.setPermissionRequestHandler(
            (_webContents, _permission, callback) => callback(false)
        );
        if (nativeOutputAllowed) {
            startNdiSender();
            startOmtSender();
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
    schedulingController?.stop();
    clearInterval(recoveryTimer);
    try { playoutRecovery?.captureNative(playoutEngine.snapshot()); }
    catch (error) { console.error("Falha ao salvar posição ao fechar:", error); }
    stopServerMediaHealthMonitor();
    cancelActivePreviews();
    closeOpenEntriesAsSkipped();
    stopNativePlayback();
    stopNdiSender();
    stopOmtSender();
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
