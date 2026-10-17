const { planRundownApplication } = require("../core/scheduling/broadcast-schedule.mjs");
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, session, hostCall, hostEvents } = require("./program-host-adapter");
const path = require("path");
const fs = require("fs");
const { flushPersistence, closePersistence, persistenceStatus } = require("../core/persistence/json-store");
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
const { Writable, PassThrough } = require("node:stream");
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
const { ProcessWatchdog } = require("../core/playout/process-watchdog");
let processWatchdog = null;
const { OperationSettings } = require("../core/playout/operation-settings");
let operationSettings = null;
let programSupervisorTimer = null;
let backendRecoveryTimer = null;
const programMetrics = { frames: 0, audioSamples: 0, startedAt: Date.now() };
let uiRecoveryTimer = null;
let shuttingDown = false;
let quitCompleted = false;
const { RundownController } = require("../core/playout/rundown-controller");
const { blackFrame, ProgramStandby } = require("../core/playout/program-standby");
const { ProgramAudioRouter } = require("../core/audio/program-audio-router");
let rundownController = null;
let programStandby = null;
let lastProgramFrame = null;
let lastFrameGeneration = -1;
let lastProgramFrameAt = 0;
let nativeStartGeneration = 0;
const programAudioRouter = new ProgramAudioRouter({onConnected:()=>videoPipeWriter.flushAudio(),onOverload:()=>videoPipeWriter.fail("NDI sem consumir PCM; reconectando esta saída.")});
const { DataBackupService, applyPendingRestore } = require("../core/backup/data-backup");
let dataBackups = null;
let preparedBackupRestore = null;
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
    profileSignature, mediaProfileSignature, mergeOutputRoutes, destinationSignature
} = require("../core/playout/output-profile");
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
    getWeeklyRundown,
    saveWeeklyRundown,
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
    updatePlayoutEntrySuccessor,
    closeOpenEntriesAsSkipped,
    getPendingFailedReportIds,
    markPlayoutEntryReady,
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


const durableChannels = new Set([
    "operation:save", "playout:apply-rundown", "playout:checkpoint",
    "media:select", "media:import", "media:remove", "timeline:save",
    "rundown:save", "rundown:weekly-save", "library-categories:save", "library-categories:select-folder",
    "web-inputs:save", "web-inputs:remove", "server-media:set-settings", "server-media:select-root",
    "settings:set-output", "settings:set-watermark-style", "settings:set-hashtag-style", "settings:set-exhibition-style",
    "report:select-folder", "report:reset-folder", "report:playout-start", "report:playout-finish"
]);
function registerTrustedHandle(channel, listener) {
    ipcMain.handle(channel, async (event, ...args) => {

        if (shuttingDown && durableChannels.has(channel)) throw Error("O aplicativo está concluindo as gravações.");
        let result;
        try {
            if (durableChannels.has(channel) && persistenceStatus().length) await flushPersistence({ retry: true });
            result = await listener(event, ...args);
            if (channel.startsWith("settings:set-") && result?.ok === true) configurationRevision++;
            if (durableChannels.has(channel) && result?.ok !== false) await flushPersistence();
            if (channel === "playout:apply-rundown" && result?.ok === true) result.persisted = true;
            return result;
        } catch (error) {
            if (result && !Array.isArray(result) && Object.hasOwn(result, "ok")) {
                if (channel === "playout:apply-rundown" && result.applied) return { ok:false, applied:true, persisted:false,
                    error:"A fila foi atualizada em memória, mas não foi possível confirmar a gravação. Verifique o disco: " + error.message };
                return { ok: false, error: "Não foi possível confirmar a gravação: " + error.message };
            }
            throw error;
        }
    });
}

function registerTrustedOn(channel, listener) {
    ipcMain.on(channel, (event, ...args) => {

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
    playoutLastError = message;
    nativePlaybackActive = false;
    playoutEngine.fault(message);

    // Em falha inesperada, enviar um frame preto valido ao sender:
    // evita que o ultimo frame do comercial congele sem aviso.
    const black = blackFrame(activeOutputProfile);
    lastProgramFrame = black;

    if (
        ndiReady &&
        ndiProcess?.stdin &&
        !ndiProcess.stdin.destroyed
    ) {
        ndiProcess.stdin.write(
            black,
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
            black
        );
    }
    if (!rundownController?.opening) void rundownController?.fault(message).catch(error => console.error("Contingência:", error.message));
}

const { IsolatedAvRoute } = require('../core/playout/isolated-av-route');
const videoPipeWriter = new IsolatedAvRoute({sendAudio:chunk=>ndiDevNullSink||programAudioRouter.write(chunk),onFault:reason=>{
    ndiLastError=reason;console.warn(reason);ndiReady=false;programAudioRouter.setPipe("");
    const failed=ndiProcess;if(failed){failed.kill();const timer=setTimeout(()=>{if(failed.exitCode===null&&failed.signalCode===null)failed.kill("SIGKILL");},1000);timer.unref();failed.once?.("close",()=>clearTimeout(timer));}
}});
function writeNativeProgramFrame(frame, samples) {
    programMetrics.frames += 1;
    videoPipeWriter.configure(activeOutputProfile);
    videoPipeWriter.write(ndiReady ? ndiProcess?.stdin : null, frame, samples);
    if (omtOutput?.canWriteVideo()) omtOutput.writeVideo(frame, { allowDrop: true });
    return true; // A destination's flow control is never the PROGRAM clock.
}

function nativeOverlay(item, position = 0, overrides = {}) {
    let outPoint = Number(item.outPoint) > 0 ? Number(item.outPoint) : Number(item.duration) || null;
    if (item.sourceType === "input" && item.inputTimingMode === "clock" && /^\d{2}:\d{2}$/.test(item.inputEndTime || "")) {
        const [h,m] = item.inputEndTime.split(":").map(Number), now = new Date(), end = new Date(now);
        end.setHours(h,m,0,0); if (end <= now) end.setDate(end.getDate()+1);
        outPoint = Math.max(1,(end-now)/1000);
    }
    return { ...item, inPointSeconds: Number(item.inPoint)||0, outPointSeconds: outPoint, durationSeconds: outPoint,
        watermarkEnabled: Boolean(item.watermark), watermarkFadeIn: false, watermarkFadeOut: false,
        ...overrides, itemId: item.id };
}
const { MediaQualityQueue } = require('../core/media/quality-queue');
let mediaChangedTimer=null;
const mediaQuality = new MediaQualityQueue({ffmpeg:require('../core/media/runtime-paths').resolveMediaRuntime('ffmpeg'),getMedia,canUseCached:file=>Boolean(serverMedia.cachedFileAvailable(file)),
    onUpdate:(id,quality)=>{updateMediaMetadata(id,{quality});
        if(!mediaChangedTimer)mediaChangedTimer=setTimeout(()=>{mediaChangedTimer=null;if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('media:changed',{});},250);}});
const analysesInProgress = new Map();
const approvedPreviewPaths = new Set();

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

            if (decodeSupport.decodable) mediaQuality.enqueue(getMedia().find(item=>item.id===mediaItem.id));

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
    const runtime = require("../core/media/runtime-paths");
    const file = runtime.resolveMediaRuntime("ffmpeg");
    runtime.verifyProgramRuntime(file);
    return file;
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

async function logoAsset(style, profile) {
    const asset = await hostCall("logoAsset", { style, profile });
    return { width: asset.width, png: Buffer.from(asset.png) };
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

    programMetrics.audioSamples += chunk.length / (channels * 4);
    videoPipeWriter.writeAudio(chunk);
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

function stopNativePlayback({ engineAction = "stop", cancelPendingStart = true } = {}) {
    if (cancelPendingStart) { nativeStartGeneration++; pendingCut = null; clearTimeout(backendRecoveryTimer); backendRecoveryTimer = null; }
    activeDeck?.stop(); activeDeck = null; ffmpegProcess = null; activeGraphics = null; audioSource = null;
    nativePlaybackActive = false; audioOutputStatus = "IDLE"; sendProgramAudioReset();
    if (engineAction === "pause") playoutEngine.pause();
    if (engineAction === "stop") { playoutEngine.stop(); lastProgramFrame = null; lastFrameGeneration = -1; serverMedia.clearActive(); sendProgramPreviewReset(); }
    if (engineAction !== "preserve") { decks.cancel(); inputPrebuffer.cancel(); warmTask = null; serverMedia.setRealtimePriority(false); }
    if (engineAction === "stop" && !shuttingDown && nativeOutputAllowed) applyOutputProfile(configuredOutputProfile());
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

function ensureTransportOutputs(ffmpegPath, profile = activeOutputProfile) {
    const configuredTransports = getSettings().output;
    for (const kind of ["srt", "rtmp"]) {
        const settings = configuredTransports[kind];
        const signature = JSON.stringify([profile.width, profile.height, profile.fpsExpression,
            profile.ffmpegPixelFormat, profile.sampleRate, profile.channels, settings]);
        const current = transportOutputs.get(kind);
        if (settings?.enabled && current && !current.stopping && current.signature === signature) continue;
        current?.stop(); transportOutputs.delete(kind);
        if (!settings?.enabled) { if (playoutLastError.startsWith(`Saída ${kind.toUpperCase()}:`)) playoutLastError = ""; continue; }
        try {
            const output = new TransportOutput({ ffmpegPath, profile, settings, kind,
                onRecovered: () => { if (playoutLastError.startsWith(`Saída ${kind.toUpperCase()}:`)) playoutLastError = ""; },
                onError: error => {
                    console.error(`[${kind.toUpperCase()}] ${error}`);
                    playoutLastError = `Saída ${kind.toUpperCase()}: ${error}`;
                } }).start();
            output.signature = signature;
            transportOutputs.set(kind, output);
        } catch (error) { playoutLastError = `Saída ${kind.toUpperCase()}: ${redactDiagnostic(error.message)}`; console.error(playoutLastError); }
    }
}

let activeDeck = null, activeSlot = 'B', preparationTimer = null, warmTask = null, lastCut = null, pendingCut = null, configurationRevision = 0;
const { DecoderDeck } = require('../core/playout/decoder-deck');
const { DeckPreparer } = require('../core/playout/deck-preparer');
function deckKey(item, position, overlay) {
    const settings = getSettings();
    const quality = getMedia().find(media => media.id === (item.sourceMediaId || item.id))?.quality;
    return JSON.stringify([configurationRevision, item.id, item.path, position, overlay.inPointSeconds, overlay.inputTimingMode === "clock" ? overlay.inputEndTime : overlay.outPointSeconds,
        overlay.sourceType, overlay.inputProtocol, overlay.inputEngine, overlay.inputHttpReferer, overlay.inputHttpUserAgent,
        item.metadataUpdatedAt, item.fileSize, quality?.checkedAt, operationSettings.value.audioLevelingEnabled, overlay.videoStreamIndex, overlay.audioStreamIndex,
        overlay.watermarkEnabled, overlay.hashtag, item.hashtag, overlay.exhibitionType, overlay.fitMode, overlay.sizePercent,
        overlay.watermarkFadeIn, overlay.watermarkFadeOut, settings.output, settings.watermarkStyle, settings.hashtagStyle, settings.exhibitionStyle]);
}
const decks = new DeckPreparer({ key: deckKey, create: createDecoderDeck });
function nextPreparedItem() {
    const snapshot = playoutEngine.snapshot(), items = getTimeline();
    if (snapshot.state !== 'PLAYING' || !rundownController?.current) return null;
    const index = items.findIndex(item => item.id === snapshot.itemId);
    const current = { ...(items[index] || rundownController.current), ...(rundownController.flags.get(snapshot.itemId) || {}) };
    if (current.freezeEnd) return null;
    return current.loop ? current : items[index + 1];
}
function tickPreparation() {
    if (pendingCut !== null) return;
    const next = nextPreparedItem(), state = playoutEngine.snapshot();
    if (!next || next.placeholder) {
        if (state.state !== 'STARTING' && (decks.candidate || warmTask)) { decks.cancel(); inputPrebuffer.cancel(); warmTask = null; }
        return;
    }
    const position = Number(next.inPoint) || 0, overlay = nativeOverlay(next, position);
    const remote = next.sourceType === 'input', remaining = state.remainingSeconds;
    const key = deckKey(next, position, overlay);
    if (decks.candidate && decks.candidate.key !== key) decks.cancel();
    if (remaining === null || remaining > 15) return;
    if (remote && warmTask?.key !== key) {
        inputPrebuffer.cancel();
        warmTask = { key, promise: prepareInputPrebuffer(next.path, overlay).catch(error => ({ ready: false, error: error.message })) };
    }
    if (!remote || remaining <= 5) void decks.prepare(next, position, overlay).catch(() => {});
}
async function resolveDeckSource(item, position, overlay, signal) {
    const filePath = item.path, remote = item.sourceType === 'input' && isRemoteInputUrl(filePath);
    const source = { url: filePath, remote, resolved: null, proxy: null, vlcBridge: null, tuner: null,
        cleanup() { for (const [resource, action] of [[this.tuner,'stop'],[this.vlcBridge,'stop'],[this.proxy,'close']]) try { resource?.[action](); } catch {} } };
    const checked = async (promise, cleanup) => { const value = await promise; if (signal.aborted) { cleanup?.(value); throw Error('Preparo cancelado.'); } return value; };
    try {
        if (remote) {
            if (!getWebInputs().some(input => input.url === filePath)) throw Error('O Input deve estar cadastrado na biblioteca.');
            if (warmTask?.key === deckKey(item, position, overlay)) await checked(warmTask.promise);
            const warmed = overlay.__resumeRemote ? null : inputPrebuffer.take(filePath, overlay);
            if (warmed) Object.assign(source, { url: warmed.playbackPath, resolved: warmed.resolved, proxy: warmed.proxy, vlcBridge: warmed.vlcBridge, tuner: warmed.tuner });
            else {
                source.resolved = await checked(resolveRemoteInput(filePath, { userAgent: overlay.inputHttpUserAgent, referer: overlay.inputHttpReferer }));
                source.url = source.resolved.url;
                if (source.resolved.provider === 'dailymotion') {
                    source.proxy = await checked(createRemoteHlsProxy(source.resolved), proxy => proxy.close()); source.url = source.proxy.url;
                }
                const vlc = findVlcPath();
                let engine = selectInputEngine(overlay.inputEngine, source.resolved.provider, Boolean(vlc));
                if ((overlay.inputEngine || 'auto') === 'auto' && vlc && isHlsInput(source.resolved.url, overlay.inputProtocol)) engine = 'vlc';
                if (engine === 'vlc') {
                    try {
                        source.vlcBridge = await checked(startVlcInputBridge(source.url, { vlcPath: vlc, withAudioCopy: true,
                            userAgent: source.proxy ? '' : source.resolved.userAgent, referer: source.proxy ? '' : source.resolved.referer,
                            startTimeSeconds: overlay.__resumeRemote ? position : 0 }), bridge => bridge.stop());
                        source.url = source.vlcBridge.videoUrl;
                    } catch (error) { if ((overlay.inputEngine || 'auto') !== 'auto') throw error; }
                }
            }
        } else {
            const libraryItem=getMedia().find(media=>path.resolve(media.path)===path.resolve(filePath));
            if(!libraryItem)throw Error('Material não cadastrado.');
            await mediaQuality.assertPlayable(libraryItem);
            if (serverMedia.isServerMediaPath(filePath)) source.url = (await checked(serverMedia.resolveForPlayback(filePath))).playbackPath;
            else if (!(await checked(fs.promises.stat(filePath))).isFile()) throw Error('Arquivo indisponível no disco.');
            if (libraryItem.quality?.status === 'approved') {
                let unchanged = false;
                try {
                    const stat = await checked(fs.promises.stat(filePath));
                    unchanged = libraryItem.quality.fingerprint === require('../core/media/quality-queue').fingerprint(stat);
                } catch (error) {
                    if (signal.aborted) throw error;
                    unchanged = source.url !== filePath && Boolean(serverMedia.cachedFileAvailable(filePath));
                }
                if (unchanged) source.loudness = libraryItem.quality.loudness;
                else mediaQuality.enqueue(libraryItem);
            }
        }
        return source;
    } catch (error) { source.cleanup(); throw remote ? Error(redactDiagnostic(error.message)) : error; }
}
async function createDecoderDeck(item, position, overlayState, signal) {
    const source = await resolveDeckSource(item, position, overlayState, signal);
    const profile = desiredOutputProfile(), filePath = item.path, isRemoteInput = source.remote;
    let graphics;
    try {
        const preparedLogo = await logoAsset(getSettings().watermarkStyle, profile);
        if (signal.aborted) throw Error('Deck cancelado.');
        const hashtag = item.hashtag || '', normalizedStartSeconds = position;
        const normalizedInPoint = Math.max(0, Number(overlayState.inPointSeconds) || 0);
        const normalizedOutPoint = Number.isFinite(Number(overlayState.outPointSeconds)) && overlayState.outPointSeconds !== null ? Number(overlayState.outPointSeconds) : null;
        const clipRemainingSeconds = normalizedOutPoint !== null ? Math.max(.001, normalizedOutPoint - position) : null;
        const samePausedItem = overlayState.__resumeRemote === true;
        const programState = { ...overlayState, liveGraphicsEnabled: true, logoRenderWidth: preparedLogo.width, startSeconds: position };
        const videoOnly = programState.__inputVideoOnly === true || (!isRemoteInput && item.audioCodec === null && item.status === 'ready');
        const playbackPath = source.url;
        graphics = new LiveGraphics({ hashtag, logoPng: preparedLogo.png }); graphics.identificationType = overlayState.exhibitionType || 'NORMAL';
    const warmedUdp =
        Boolean(
            isRemoteInput &&
            source.vlcBridge &&
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
        isRemoteInput ? "+genpts+discardcorrupt" : "+genpts",
        "-err_detect",
        isRemoteInput ? "ignore_err" : "explode",
        "-probesize",
        isRemoteInput || warmedUdp
            ? "1000000"
            : "10000000",
        "-analyzeduration",
        isRemoteInput || warmedUdp
            ? "500000"
            : "10000000"
    ];

    if (!isRemoteInput) args.push("-xerror");

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
                        source.resolved?.userAgent ??
                        programState.inputHttpUserAgent,
                    referer:
                        source.resolved?.referer ??
                        programState.inputHttpReferer,
                    cookie:
                        source.resolved?.cookie ?? "",
                    realtime: true
                }
            )
        );
    }

    if (source.tuner) args.push("-live_start_index", "-2");

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
        // Raw frames need no frame-threaded encoder queue. A fixed single
        // output thread avoids auto-sized lookahead/CPU bursts between decks.
        "-threads:v", "1",
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
        "-threads:v", "1",
        "-q:v",
        "5",
        "-f",
        "image2pipe",
        "pipe:3"
    );

    // One demuxer/clock for remote PROGRAM audio and video. Separate HTTP
    // connections can start at different live edges and probe at different speeds.
    const sharedRemoteAudio = !videoOnly;
    if (sharedRemoteAudio) {
        args.push(
            "-map", Number.isSafeInteger(programState.audioStreamIndex) && programState.audioStreamIndex >= 0
                ? `0:${programState.audioStreamIndex}?` : "0:a:0?",
            "-vn", "-sn", "-dn",
            "-af", require('../core/audio/loudness').buildAudioLevelFilter({enabled:operationSettings.value.audioLevelingEnabled,
                loudness:source.loudness,sampleRate:profile.sampleRate,channels:profile.channels}),
            "-ac", String(profile.channels), "-ar", String(profile.sampleRate),
            "-c:a", "pcm_f32le", "-f", "f32le"
        );
        if (clipRemainingSeconds !== null) args.push("-t", clipRemainingSeconds.toFixed(3));
        args.push("pipe:4");
    }

        args.splice(0, 0, "-filter_complex_threads", "2", "-threads", "2");
        let deck;
        deck = new DecoderDeck({ executable: resolveFfmpegPath(), args, profile, graphics, source,
            requireAudio: sharedRemoteAudio, duration: clipRemainingSeconds, remote: isRemoteInput, signal,
            onFirst: () => { if (activeDeck !== deck) return; lastCut.gapMs = programClock.nowMs() - lastCut.previousFrameAt;
                playoutEngine.markReady(); rundownController?.ready(playoutEngine.snapshot()); },
            onFrame: frame => { if (activeDeck !== deck) return;
                if (deck.delivered > 0) programMetrics.maxFrameGapMs = Math.max(programMetrics.maxFrameGapMs || 0, programClock.nowMs() - lastProgramFrameAt);
                lastProgramFrame = frame; lastFrameGeneration = playoutEngine.generation;
                lastProgramFrameAt = programClock.nowMs(); const count=Math.floor((deck.delivered+1)*profile.sampleRate*profile.fpsD/profile.fpsN)-Math.floor(deck.delivered*profile.sampleRate*profile.fpsD/profile.fpsN);
                const writable = writeNativeProgramFrame(frame,count); for (const output of transportOutputs.values()) output.writeVideo(frame); return writable; },
            onPreview: sendProgramPreviewFrame,
            createAudio: pcmStream => new NdiAudioSource({ pcmStream, pipePath: '', ffmpegPath: resolveFfmpegPath(), filePath,
                sampleRate: profile.sampleRate, channels: profile.channels, onPcmData: sendProgramAudioPcm }).start(),
            onFinish: error => {
                if (activeDeck !== deck) return;
                activeDeck = null; ffmpegProcess = null; activeGraphics = null; audioSource = null; nativePlaybackActive = false;
                audioOutputStatus = 'IDLE'; serverMedia.setRealtimePriority(false);
                if (error) { onPlayoutFault(describeRemoteInputError(redactDiagnostic(error.message), { provider: source.resolved?.provider })); return; }
                const ended = playoutEngine.complete();
                mainWindow?.webContents.send('playout:native-ended', { ...ended, autonomous: true });
                queueMicrotask(() => void rundownController?.ended(ended).catch(error => console.error('Avanço:', error.message)));
            }
        });
        await deck.ready;
        return deck;
    } catch (error) {
        graphics?.stop(); source.cleanup();
        if (!signal.aborted && !overlayState.__inputVideoOnly && /does not contain any stream|matches no streams/i.test(error.message))
            return createDecoderDeck(item, position, { ...overlayState, __inputVideoOnly: true }, signal);
        if (!signal.aborted && source.vlcBridge && (overlayState.inputEngine || 'auto') === 'auto' && !overlayState.__inputFallbackAttempted) {
            console.warn('Ponte VLC não entregou vídeo; tentando FFmpeg direto.');
            return createDecoderDeck(item, position, { ...overlayState, inputEngine: 'ffmpeg', __inputFallbackAttempted: true }, signal);
        }
        throw isRemoteInput ? Error(describeRemoteInputError(redactDiagnostic(error.message), { provider: source.resolved?.provider })) : error;
    }
}
async function startNativePlayback(filePath, startSeconds = 0, hashtag = '', overlayState = {}) {
    const token = ++nativeStartGeneration, prior = overlayState.__priorPlayout || playoutEngine.snapshot();
    pendingCut = token;
    const preparingRevision = configurationRevision;
    try {
    if (prior.state === 'PAUSED' && prior.itemId === overlayState.itemId && prior.filePath === filePath) startSeconds = prior.positionSeconds;
    const source = getTimeline().find(item => item.id === overlayState.itemId) || getMedia().find(item => item.path === filePath) || {};
    const item = { ...source, ...overlayState, id: overlayState.itemId || source.id, path: filePath, hashtag };
    const overlay = { ...overlayState, __resumeRemote: prior.state === 'PAUSED' && prior.itemId === item.id && item.sourceType === 'input' };
    const prepared = decks.candidate?.key === deckKey(item, startSeconds, overlay) && Boolean(decks.candidate?.deck?.readyState);
    const deck = await decks.take(item, startSeconds, overlay);
    if (token !== nativeStartGeneration) { deck.stop(); throw Error('CUT cancelado por outro comando.'); }
    if (preparingRevision !== configurationRevision) {
        deck.stop();
        if ((overlayState.__configurationRetry || 0) >= 2) throw Error('Configuração alterada repetidamente durante o preparo.');
        return startNativePlayback(filePath, startSeconds, hashtag, { ...overlayState, __configurationRetry: (overlayState.__configurationRetry || 0) + 1 });
    }
    const fromPid = activeDeck?.child.pid || lastCut?.toPid || null, previousFrameAt = lastProgramFrameAt;
    stopNativePlayback({ engineAction: 'preserve', cancelPendingStart: false });
    activeSlot = activeSlot === 'A' ? 'B' : 'A'; activeDeck = deck; ffmpegProcess = deck.child; activeGraphics = deck.graphics;
    nativePlaybackActive = true; playoutLastError = ''; applyOutputProfile(deck.profile);
    lastCut = { prepared, fromPid, toPid: deck.child.pid, previousFrameAt, gapMs: null };
    programMetrics.maxFrameGapMs = 0;
    playoutEngine.start({ filePath, itemId: item.id, inPointSeconds: overlay.inPointSeconds || 0,
        startSeconds, outPointSeconds: overlay.outPointSeconds, waitForFirstFrame: true });
    serverMedia.markActive(filePath); serverMedia.setRealtimePriority(item.sourceType === 'input');
    programAudioRouter.setPipe(ndiAudioReady ? ndiAudioPipe : ''); ensureTransportOutputs(resolveFfmpegPath());
    if (item.sourceType === "input" && overlay.inputTimingMode === "clock") deck.duration = Math.max(.001, Number(overlay.outPointSeconds) - startSeconds);
    const firstFrame = deck.activate(); audioSource = deck.audioSource; audioOutputStatus = 'PLAYING';
    await firstFrame;
    return { ok: true, filePath, startSeconds, playout: playoutEngine.snapshot() };
    } finally { if (pendingCut === token) pendingCut = null; }
}

async function validateWatermarkImage(filePath) { return hostCall("validateWatermark", { filePath }); }
async function createWatermarkPreviewDataUrl(filePath) { return hostCall("watermarkPreview", { filePath }); }

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

function redactDiagnostic(value) {
    return require("../core/playout/diagnostic-redaction").redactDiagnostic(value);
}

function registerIpcHandlers() {
    async function libraryWatchSource(id) {
        const item = getMedia().find(media => media.id === id && media.sourceType !== 'input' && !media.placeholder);
        if (!item) throw Error('Material não cadastrado na Biblioteca.');
        const source = await serverMedia.resolveForPlayback(item.path);
        const filePath = await fs.promises.realpath(source.playbackPath);
        if (!(await fs.promises.stat(filePath)).isFile()) throw Error('Arquivo indisponível.');
        return filePath;
    }
    registerTrustedHandle('media:watch-source', async (_event, id) => {
        try { return {ok:true,filePath:await libraryWatchSource(id)}; }
        catch (error) { return {ok:false,error:error.message}; }
    });
    registerTrustedHandle('media:watch-external', async (_event, id) => {
        try {
            const filePath = await libraryWatchSource(id);
            if (!['.mp4','.m4v','.mov','.mkv','.avi','.mxf','.ts','.mts','.m2ts','.webm','.mpeg','.mpg','.wmv','.flv'].includes(path.extname(filePath).toLowerCase()))
                throw Error('Formato não permitido para abertura externa.');
            const error = await shell.openPath(filePath);
            return error ? {ok:false,error} : {ok:true};
        } catch (error) { return {ok:false,error:error.message}; }
    });
    registerTrustedHandle("operation:get", async () => ({ ok: true, settings: operationSettings.value,
        startupAvailable: process.platform === "win32" && app.isPackaged,
        diagnostics: { mediaQuality:mediaQuality.snapshot(), persistence: persistenceStatus(), metrics: { ...programMetrics, ndiVideo: videoPipeWriter.snapshot(), memory: process.memoryUsage() }, engine: playoutEngine.snapshot(), lastIssue: rundownController?.lastIssue, contingency: rundownController?.contingency,
            frameAgeMs: lastProgramFrameAt ? Math.max(0,programClock.nowMs()-lastProgramFrameAt) : null,
            ndiAudio: { connected: programAudioRouter.connected, bytes: programAudioRouter.bytes, droppedBytes: programAudioRouter.droppedBytes },
            transports: Object.fromEntries([...transportOutputs].map(([kind,out]) => [kind,{online:out.online,error:out.error}])) } }));
    registerTrustedHandle("operation:save", async (_event, patch) => {
        try {
            if (patch?.fillerMediaId && !getMedia().some(item => item.id === patch.fillerMediaId && Number(item.duration)>0)) throw Error("Escolha um vídeo cadastrado para contingência.");
            if (typeof patch?.startOnLogin === "boolean" && patch.startOnLogin !==
                (process.platform === "win32" && app.isPackaged ? operationSettings.value.startOnLogin : operationSettings.value.startOnLogin)) {
                if (process.platform !== "win32" || !app.isPackaged) throw Error("Início automático está disponível no aplicativo instalado no Windows.");
                await app.setLoginItemSettings({ openAtLogin: patch.startOnLogin, path: process.execPath });
            }
            const settings = operationSettings.update(patch);
            if (processWatchdog) { if (settings.watchdogEnabled) processWatchdog.start(); else processWatchdog.stop(); }
            return { ok: true, settings };
        } catch (error) { return { ok: false, error: error.message }; }
    });
    registerTrustedHandle("operation:diagnostics", async () => {
        const selected = await dialog.showSaveDialog(mainWindow,{title:"Exportar diagnóstico",defaultPath:"Santtos-diagnostico.json",filters:[{name:"Diagnóstico",extensions:["json"]}]});
        if (selected.canceled) return { canceled:true };
        await fs.promises.writeFile(selected.filePath,JSON.stringify(redactDiagnostic({version:app.getVersion(),platform:process.platform,createdAt:new Date().toISOString(),engine:redactDiagnostic(playoutEngine.snapshot()),
            profile:{resolution:activeOutputProfile.resolution,fps:activeOutputProfile.fpsText,pixelFormat:activeOutputProfile.pixelFormat},lastIssue:redactDiagnostic(rundownController?.lastIssue),
            ndi:{ready:ndiReady,error:ndiLastError},omt:redactDiagnostic(omtStatus()),transports:Object.fromEntries([...transportOutputs].map(([kind,out])=>[kind,{online:out.online,error:out.error}]))}),null,2));
        return {ok:true};
    });
    registerTrustedHandle("playout:next", () => rundownController?.advance("skipped"));
    registerTrustedHandle("playout:flags", (_event, id, flags) => {
        if (!getTimeline().some(item => item.id === id)) return { ok: false, stale: true };
        const patch = {}; for (const key of ["loop", "freezeEnd"]) if (typeof flags?.[key] === "boolean") patch[key] = flags[key];
        rundownController?.setFlags(id, patch); return { ok: true };
    });
    registerTrustedHandle("playout:apply-rundown", async (_event, items, context) => {
        if (!Array.isArray(items)) throw Error("Programação inválida.");
        let snapshot = playoutEngine.snapshot(), current = getTimeline().find(item => item.id === snapshot.itemId) || rundownController?.current;
        let preserve = current && ["PLAYING", "STARTING", "PAUSED"].includes(snapshot.state);
        let alignment = null;
        if (context?.date) {
            const saved = getDailyRundown(context.date);
            if (saved.updatedAt !== context.expectedUpdatedAt || saved.startAt !== context.expectedStartAt)
                throw Error("A programação ou o término do dia anterior mudou. Atualize antes de aplicar.");
            if (saved.missingItems) throw Error("Há materiais ausentes nesta programação. Substitua-os antes de aplicar.");
            await mediaQuality.validate(saved.items);
            const rechecked = getDailyRundown(context.date);
            if (rechecked.updatedAt !== saved.updatedAt || rechecked.startAt !== saved.startAt)
                throw Error("A programação mudou durante a validação. Atualize antes de aplicar.");
            snapshot=playoutEngine.snapshot();current=getTimeline().find(item=>item.id===snapshot.itemId)||rundownController?.current;
            preserve=current&&["PLAYING","STARTING","PAUSED"].includes(snapshot.state);
            const canonical = saved.items.map((item,index) => ({ ...item,
                id: `rundown-${context.date}-${Date.now()}-${index}`, loop:false, freezeEnd:false,
                programmedStartTime:saved.startTime }));
            alignment = planRundownApplication({ items:canonical, date:saved.date, startAt:saved.startAt,
                queue:current?.isContingency ? [] : getTimeline(), snapshot:current?.isContingency ? {} : snapshot });
            saveTimeline(alignment.timeline);
            addLog(`Programação ${saved.date}: ${alignment.message}`);
        } else {
            // Compatibility for restored/legacy clients without a dated schedule.
            saveTimeline(preserve && !current.isContingency ? [current, ...items] : items);
        }
        if (rundownController?.current?.isContingency && items.length) await rundownController.play(getTimeline()[0]);
        else if (!preserve && rundownController) {
            rundownController.stop(); rundownController.current = null;
            playoutEngine.itemId = null; playoutEngine.filePath = null;
        }
        const result = { ok: true, applied:true, persisted:false, message:alignment?.message, deltaSeconds:alignment?.deltaSeconds, timeline: getTimeline(), playout: { ...playoutEngine.snapshot(), autonomous: true } };
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("playout:rundown-changed", result);
        return result;
    });
    const backupResult = async action => { try { return await action(); } catch (error) { return { ok: false, error: error.message }; } };
    registerTrustedHandle("backup:status", () => backupResult(async () => ({ ok: true, ...await dataBackups.run("status"), busy: dataBackups.busy, error: dataBackups.lastError })));
    registerTrustedHandle("backup:settings", (_event, settings) => backupResult(() => dataBackups.run("configure", {
        enabled: settings?.enabled, intervalHours: settings?.intervalHours, keep: settings?.keep })));
    registerTrustedHandle("backup:folder", () => backupResult(async () => {
        const selected = await dialog.showOpenDialog(mainWindow, { title: "Pasta adicional para backups", properties: ["openDirectory", "createDirectory"] });
        if (selected.canceled) return { canceled: true };
        return dataBackups.run("configure", { additionalFolder: path.join(selected.filePaths[0], "SanTTos Playout Backups") });
    }));
    registerTrustedHandle("backup:clear-folder", () => backupResult(() => dataBackups.run("configure", { additionalFolder: "" })));
    registerTrustedHandle("backup:create", () => backupResult(() => dataBackups.run("create")));
    registerTrustedHandle("backup:open-folder", () => backupResult(async () => {
        const { localFolder } = await dataBackups.run("status"); await fs.promises.mkdir(localFolder, { recursive: true });
        const error = await shell.openPath(localFolder); return error ? { ok: false, error } : { ok: true };
    }));
    registerTrustedHandle("backup:export", () => backupResult(async () => {
        const selected = await dialog.showSaveDialog(mainWindow, { title: "Exportar dados do Santtos", defaultPath: `Santtos-${new Date().toISOString().slice(0,10)}.santtos-backup`,
            filters: [{ name: "Backup Santtos", extensions: ["santtos-backup"] }] });
        if (selected.canceled) return { canceled: true };
        return dataBackups.run("export", { file: selected.filePath });
    }));
    registerTrustedHandle("backup:inspect", () => backupResult(async () => {
        preparedBackupRestore = null;
        const selected = await dialog.showOpenDialog(mainWindow, { title: "Selecionar backup para restaurar", properties: ["openFile"], filters: [{ name: "Backup Santtos", extensions: ["santtos-backup"] }] });
        if (selected.canceled) return { canceled: true };
        const info = await dataBackups.run("inspect", { file: selected.filePaths[0] });
        preparedBackupRestore = { file: selected.filePaths[0], createdAt: info.createdAt };
        return { ok: true, info };
    }));
    registerTrustedHandle("backup:restore", () => backupResult(async () => {
        if (!preparedBackupRestore) throw Error("Selecione e valide o backup antes de restaurar.");
        if (["PLAYING", "STARTING", "PAUSED"].includes(playoutEngine.snapshot().state)) throw Error("Pare o PROGRAM antes de restaurar os dados.");
        const current = await dataBackups.run("inspect", { file: preparedBackupRestore.file });
        if (current.createdAt !== preparedBackupRestore.createdAt) throw Error("O backup mudou. Selecione novamente.");
        await dataBackups.run("stage", { file: preparedBackupRestore.file });
        preparedBackupRestore = null; app.relaunch(); app.quit(); return { ok: true };
    }));

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
        if (nativeOutputAllowed && (rundownController?.finished || native.state !== "IDLE")) return { ok: true, backendManaged: true };
        await playoutRecovery.saveAsync(nativeOutputAllowed && native.itemId === checkpoint.itemId &&
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
                !ndiProcess.killed && !ndiDevNullSink,
            source: ndiSourceName,
            profile: {
                ...activeOutputProfile,
                signature: activeOutputSignature
            },
            ndiTestMode: isNdiTestBench,
            audio: audioSource
                ? { ...audioSource.snapshot(), route: ndiSourceName,
                    connected: programAudioRouter.connected, routedToNdi: programAudioRouter.connected, bytesSent: programAudioRouter.bytes,
                    nativeActive: ndiAudioNativeActive,
                    receiverVerified: false }
                : { state: audioOutputStatus, error: audioOutputError || null,
                    active: false, leftDb: -60, rightDb: -60,
                    peakLeftDb: -60, peakRightDb: -60,
                    nativeActive: ndiAudioNativeActive,
                    sampleRate: activeOutputProfile.sampleRate,
                    channels: activeOutputProfile.channels,
                    receiverVerified: false, connected: programAudioRouter.connected, routedToNdi: programAudioRouter.connected, bytesSent: programAudioRouter.bytes, route: ndiSourceName },
            nativePlaybackActive,
            programClock: programClock.snapshot(),
            service: { pid: process.pid, architecture: "dedicated-process" },
            omt: omtStatus(),
            graphics: activeGraphics?.snapshot() ?? null,
            transports: Object.fromEntries([...transportOutputs].map(([kind, output]) => [kind, { online: output.online, error: output.error }])),
            playout: { ...playoutEngine.snapshot(), autonomous: Boolean(rundownController), currentItem: rundownController?.current, preparedNext: decks.snapshot() },
            playoutError: playoutLastError || null,
            persistenceError: persistenceStatus().length ? "Não foi possível salvar os dados. Verifique o espaço e o acesso ao disco antes de fechar o programa." : null,
            error: ndiLastError || null,
            devNullSink: ndiDevNullSink,
            preparedInput: decks.snapshot(),
            decks: { active: activeDeck ? { slot: activeSlot, ...activeDeck.snapshot() } : null, prepared: decks.snapshot(), lastCut },
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
                const saved = getTimeline().find(item => item.id === overlayState?.itemId);
                const source = saved || getMedia().find(item => item.path === filePath) || getWebInputs().find(item => item.url === filePath);
                if (!source) throw Error("Material não cadastrado.");
                const item = { ...source, id: overlayState?.itemId || source.id, path: filePath, hashtag,
                    sourceType: overlayState?.sourceType || source.sourceType || "file",
                    inPoint: overlayState?.inPointSeconds ?? source.inPoint ?? 0,
                    outPoint: overlayState?.outPointSeconds ?? source.outPoint ?? source.duration,
                    duration: source.duration || overlayState?.durationSeconds };
                const flags = {}; for (const key of ["loop", "freezeEnd"]) if (typeof overlayState?.[key] === "boolean") flags[key] = overlayState[key];
                rundownController.setFlags(item.id, flags);
                if (playoutEngine.snapshot().state === "PAUSED" && playoutEngine.itemId === item.id) startSeconds = playoutEngine.positionSeconds();
                return await rundownController.play(item, startSeconds, overlayState);
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
            return rundownController ? rundownController.pause() : { ok: true, playout: stopNativePlayback({ engineAction: "pause" }) };
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
            return rundownController ? rundownController.stop() : { ok: true, playout: stopNativePlayback({ engineAction: "stop" }) };
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
                    pendingCut !== null || engineState === "PLAYING" || engineState === "STARTING" ||
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
                if (output?.srt?.enabled) transportUrl(output.srt, "srt");
                if (output?.rtmp?.enabled) transportUrl(output.rtmp, "rtmp");
                const saved = updateOutputSettings(output);
                if (nativeOutputAllowed) applyOutputProfile(configuredOutputProfile());
                return {
                    ok: true,
                    output: saved,
                    profile:
                        configuredOutputProfile(),
                    pendingProfile: mediaProfileSignature(activeOutputProfile) !== mediaProfileSignature(desiredOutputProfile())
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
                    await createWatermarkPreviewDataUrl(
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
                    await validateWatermarkImage(
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
                    await validateWatermarkImage(
                        style.filePath
                    );
                }

                return {
                    ok: true,
                    watermarkStyle: await (async () => {
                        const saved = updateWatermarkStyle(style);
                        if (activeGraphics) {
                            const asset = await logoAsset(saved, activeOutputProfile);
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
            if (rundownController) return { ok: true, backendManaged: true };
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
            if (rundownController) return { ok: true, backendManaged: true };
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
                    folder: await setReportFolder(
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
            folder: await resetReportFolder()
        })
    );

    registerTrustedHandle("rundown:weekly-get", (_event, weekday) => getWeeklyRundown(weekday));
    registerTrustedHandle("rundown:weekly-save", (_event, weekday, rundown) => {
        try { return { ok: true, rundown: saveWeeklyRundown(weekday, rundown) }; }
        catch (error) { return { ok: false, error: error.message }; }
    });
    registerTrustedHandle("rundown:html", async (_event, rundown) => {
        try {
            const html = require("../core/scheduling/rundown-pdf").rundownPrintHtml(rundown);
            const selected = await dialog.showSaveDialog(mainWindow, { title: "Salvar roteiro em HTML", defaultPath: `Roteiro-${rundown.date}.html`, filters: [{ name: "HTML", extensions: ["html"] }] });
            if (selected.canceled) return { ok: true, canceled: true };
            await fs.promises.writeFile(selected.filePath, html, "utf8"); return { ok: true };
        } catch (error) { return { ok: false, error: error.message }; }
    });
    registerTrustedHandle("rundown:pdf", async (_event, rundown) => {
        try {
            const selected = await dialog.showSaveDialog(mainWindow, { title: "Salvar roteiro em PDF", defaultPath: `Roteiro-${rundown.date}.pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }] });
            if (selected.canceled) return { ok: true, canceled: true };
            const pdf = await hostCall("renderPdf", { rundown });
            await fs.promises.writeFile(selected.filePath, pdf);
            return { ok: true };
        } catch (error) { return { ok: false, error: error.message }; }
    });

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

            for(const item of media)if(!["pending-metadata","analyzing"].includes(item.status)&&(!item.quality||["queued","checking"].includes(item.quality.status)||(item.quality.status==='approved'&&!item.quality.loudness)))mediaQuality.enqueue(item);

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

    registerTrustedHandle("media:analyze",(_event,id)=>{const item=getMedia().find(item=>item.id===id);if(!item)throw Error("Material não cadastrado.");mediaQuality.enqueue(item);return {ok:true};});

    registerTrustedHandle(
        "media:remove",
        async (_event, mediaId) =>
            removeMedia(mediaId)
    );
}

function desiredOutputProfile() {
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

function configuredOutputProfile() {
    const desired = desiredOutputProfile();
    const state = playoutEngine.snapshot().state;
    return nativePlaybackActive || pendingCut !== null || state === "PAUSED"
        ? mergeOutputRoutes(activeOutputProfile, desired) : desired;
}
function applyOutputProfile(profile) {
    const previous = activeOutputProfile;
    const ndiChanged = destinationSignature(previous, 'ndi') !== destinationSignature(profile, 'ndi');
    const omtChanged = destinationSignature(previous, 'omt') !== destinationSignature(profile, 'omt');
    activeOutputProfile = profile; activeOutputSignature = profileSignature(profile);
    if (mediaProfileSignature(previous) !== mediaProfileSignature(profile)) { lastProgramFrame = null; lastFrameGeneration = -1; }
    if (ndiChanged) restartNdiSenderForProfile();
    else if (profile.ndiEnabled && !ndiProcess) startNdiSender();
    if (omtChanged) restartOmtSenderForProfile();
    else if (profile.omtEnabled && !omtOutput) startOmtSender();
    ensureTransportOutputs(resolveFfmpegPath(), profile);
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

            programAudioRouter.setPipe("");
            videoPipeWriter.reset();

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
                        programAudioRouter.setPipe(ndiAudioPipe);
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

        ndiReady = false;
        ndiProcess = null;
        scheduleNdiRestart();
    }
}

function stopNdiSender({
    permanent = true,
    engineAction = "stop",
    stopProgram = true
} = {}) {
    ndiStopping = permanent;

    if (ndiRestartTimer) {
        clearTimeout(ndiRestartTimer);
        ndiRestartTimer = null;
    }

    if (stopProgram) stopNativePlayback({ engineAction });

    ndiFrameBusy = false;
    ndiReady = false;
    ndiDevNullSink = false;
    ndiAudioReady = false;
    ndiAudioNativeActive = false;
    ndiAudioPipe = "";
    programAudioRouter.setPipe("");
    videoPipeWriter.reset();

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
        stopProgram: false
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

    applyPendingRestore(app.getPath("userData"));
    initializeDatabase({
        userDataPath: app.getPath("userData"),
        migrateLegacy: !isTestBench
    });
    schedulingController = {
        status: () => hostCall("controllerStatus"), start: () => hostCall("controllerStart"), stop: () => hostCall("controllerStop")
    };
    playoutRecovery = new PlayoutRecovery(app.getPath("userData"));
    recoveryTimer = setInterval(() => {
        void playoutRecovery.captureNativeAsync(playoutEngine.snapshot()).catch(error => console.error("Falha ao salvar recuperação do PROGRAM:", error));
    }, 1000);
    serverMedia.initialize(
        app.getPath("userData"),
        app.getPath("cache")
    );
    startServerMediaHealthMonitor();
    initializeLibraryCategories(app.getPath("userData"));
    initializeWebInputs(app.getPath("userData"));
    operationSettings = new OperationSettings(app.getPath("userData"));
    initializePlayoutReports({
        userDataPath: app.getPath("userData"),
        documentsPath: isTestBench
            ? path.join(testBenchConfig.userDataPath, "documents")
            : app.getPath("documents")
    });
    if (nativeOutputAllowed) {
        rundownController = new RundownController({ getItems: getTimeline, snapshot: () => playoutEngine.snapshot(),
            startLive: item => {
                stopNativePlayback({ engineAction: "stop" });
                playoutEngine.start({ itemId: item.id, filePath: "", outPointSeconds: item.duration, waitForFirstFrame: true });
                playoutEngine.pause();
            },
            start: (item, position, overrides) => {
                const overlay = nativeOverlay(item, position, overrides);
                const priorPlayout = playoutEngine.snapshot();
                return startNativePlayback(item.path, position, item.hashtag || "", { ...overlay, __priorPlayout: priorPlayout });
            },
            stop: mode => { stopNativePlayback({ engineAction: mode === "fault" ? "preserve" : mode });
                if (mode === "fault") playoutEngine.fault(rundownController.lastIssue || "Contingência"); },
            getContingency: () => getMedia().find(item => item.id === operationSettings.value.fillerMediaId),
            reportStart: startPlayoutEntry, reportFinish: finishPlayoutEntry,
            reportReady: markPlayoutEntryReady,
            reportSuccessor: updatePlayoutEntrySuccessor,
            onContingency: () => { lastProgramFrame = blackFrame(activeOutputProfile); },
            onChange: () => {
                const snapshot = playoutEngine.snapshot();
                if (snapshot.state === "IDLE" && rundownController.current) {
                    void playoutRecovery.saveAsync({ itemId: rundownController.current.id,
                        positionSeconds: rundownController.finished ? Number(rundownController.current.outPoint)||Number(rundownController.current.duration)||0 : snapshot.positionSeconds,
                        playing: false, rundownFinished: rundownController.finished }).catch(error => console.error("Checkpoint final:", error));
                }
                else void playoutRecovery.captureNativeAsync(snapshot).catch(error => console.error("Checkpoint do motor:", error));
                if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("playout:state", { ...snapshot, autonomous: true });
            }
        });
        rundownController.pendingFailures.push(...getPendingFailedReportIds());
        programStandby = new ProgramStandby({ getProfile: () => activeOutputProfile,
            isPlaying: () => (nativePlaybackActive && lastFrameGeneration === playoutEngine.generation && programClock.nowMs() - lastProgramFrameAt < 1000),
            getFrame: () => playoutEngine.snapshot().state !== "IDLE" && lastProgramFrame?.length === activeOutputProfile.frameSize ? lastProgramFrame : null,
            onFrame: (frame,samples) => { writeNativeProgramFrame(frame,samples); for (const output of transportOutputs.values()) output.writeVideo(frame); },
            onAudio: sendProgramAudioPcm });
        programStandby.start();
        programSupervisorTimer = setInterval(() => {
            const state = playoutEngine.snapshot();
            if (state.state === "PLAYING" && programClock.nowMs() - lastProgramFrameAt > operationSettings.value.stallSeconds * 1000) {
                onPlayoutFault(`Sem novos quadros do material por ${operationSettings.value.stallSeconds} segundos.`);
            }
        }, 1000);
        programSupervisorTimer.unref();
        const saved = playoutRecovery.state;
        const item = saved && (getTimeline().find(item => item.id === saved.itemId) ||
            (saved.itemId === "__contingency__" ? { ...rundownController.getContingency?.(), id: "__contingency__", isContingency: true, loop: true } : null));
        if (item?.path || item?.liveSlot) {
            const position = Math.max(Number(item.inPoint)||0, Math.min(Number(item.outPoint)||Number(item.duration)||saved.positionSeconds, saved.positionSeconds));
            if (saved.playing && operationSettings.value.resumeOnLaunch) {
                backendRecoveryTimer = setTimeout(() => void rundownController.play(item, position).catch(error => console.error("Retomada:", error.message)), 1000);
                backendRecoveryTimer.unref();
            } else {
                rundownController.current = item;
                playoutEngine.start({ filePath: item.path, itemId: item.id, inPointSeconds: Number(item.inPoint)||0, startSeconds: position, outPointSeconds: Number(item.outPoint)||Number(item.duration)||null });
                if (saved.rundownFinished || saved.ended) { rundownController.finished = saved.rundownFinished === true; playoutEngine.complete(); }
                else playoutEngine.pause();
            }
        }
    }
    dataBackups = new DataBackupService(app.getPath("userData"), app.getVersion(), () => flushPersistence());
    dataBackups.start();
    preparationTimer = setInterval(tickPreparation, 200); preparationTimer.unref();
    addLog("Sistema iniciado");

    console.log("Banco de dados OK");
    console.log(
        `Relatórios de exibição: ${getReportFolder()}`
    );
}

async function boot() {
    mainWindow = { isDestroyed: () => false, webContents: { send: hostEvents } };
    startSystem();
    if (nativeOutputAllowed) { startNdiSender(); startOmtSender(); ensureTransportOutputs(resolveFfmpegPath()); }
    registerIpcHandlers();
}
async function shutdown() {

    if (quitCompleted) return;
    if (shuttingDown) return;
    shuttingDown = true;
    const closingSnapshot = playoutEngine.snapshot();
    if (rundownController && ["PLAYING", "STARTING"].includes(closingSnapshot.state)) rundownController.pause();
    else playoutEngine.pause();
    try {
    processWatchdog?.stop();
    clearInterval(preparationTimer); decks.cancel(); inputPrebuffer.cancel();
    clearInterval(programSupervisorTimer); clearTimeout(backendRecoveryTimer); clearTimeout(uiRecoveryTimer);

    dataBackups?.stop();
    programStandby?.stop();
    videoPipeWriter.reset();
    programAudioRouter.stop();
    for (const output of transportOutputs.values()) output.stop();
    transportOutputs.clear();
    schedulingController?.stop();
    clearTimeout(mediaChangedTimer);
    await mediaQuality.stop();
    clearInterval(recoveryTimer);
    stopNativePlayback({ engineAction: "preserve" });
    try { await playoutRecovery?.captureNativeAsync(closingSnapshot); await playoutRecovery?.flush(); }
    catch (error) { console.error("Falha ao salvar posição ao fechar:", error); }
    stopServerMediaHealthMonitor();
    cancelActivePreviews();
    rundownController?.closeReport("PULADO", { reason: "Aplicativo encerrado" });
    try { closeOpenEntriesAsSkipped(); } catch (error) { console.error("Falha ao concluir histórico:", error); }
    await listReportFiles().catch(error => console.error("Falha ao concluir relatório:", error));
    } catch (error) { console.error("Falha ao encerrar:", error); }
    finally {
        // Keep the app alive until pending data is durable. Repeated quit events
        // cannot bypass this barrier; discarding requires an explicit choice.
        for (;;) {
            try { await flushPersistence({ retry: true }); await closePersistence(); break; }
            catch (error) {
                const answer = await dialog.showMessageBox(mainWindow ?? undefined, {
                    type: "error", title: "Dados ainda não foram salvos",
                    message: "Não foi possível concluir a gravação dos dados.",
                    detail: "Verifique o disco e tente novamente. Fechar sem salvar pode perder as últimas alterações.",
                    buttons: ["Tentar novamente", "Fechar sem salvar"], defaultId: 0, cancelId: 0
                });
                if (answer.response === 1) break;
            }
        }
        stopNativePlayback(); stopNdiSender(); stopOmtSender(); quitCompleted = true;
    }
}
module.exports = { boot, shutdown };
