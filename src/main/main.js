"use strict";
const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, protocol, session, utilityProcess } = require("electron");
const path = require("node:path"), fs = require("node:fs");
const { fileURLToPath } = require("node:url");
const { configureTestBench } = require("./testbench");
const { ProgramServiceClient } = require("./program-service-client");
const { SchedulingWebController } = require("../core/scheduling/web-controller");
const { MEDIA_SCHEME, serveImportedVideo } = require("../core/media/media-protocol");
const { INPUT_PREVIEW_SCHEME, serveWebInputPreview } = require("../core/media/web-input-preview");
const { resolveMediaRuntime } = require("../core/media/runtime-paths");
const { ProcessWatchdog } = require("../core/playout/process-watchdog");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
// The confidence monitor must keep scheduling PCM/JPEG while covered or minimized.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
if (process.platform === "win32") app.setAppUserModelId("com.santtos.tvautomation");
const testBenchConfig = configureTestBench(app), isTestBench = testBenchConfig.enabled, isNdiTestBench = testBenchConfig.ndiEnabled;
const isDevelopment = !app.isPackaged;
let mainWindow = null, service = null, controller = null, uiRecoveryTimer = null, watchdog = null;
let shuttingDown = false, quitCompleted = false;
const approvedPreviewPaths = new Set();
protocol.registerSchemesAsPrivileged([MEDIA_SCHEME, INPUT_PREVIEW_SCHEME].map(scheme => ({ scheme,
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: scheme === INPUT_PREVIEW_SCHEME } })));
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
            backgroundThrottling: false,
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

    mainWindow.webContents.on("render-process-gone", (_event, details) => {
        service?.resetMonitor();
        console.error(`Interface interrompida (${details.reason}); PROGRAM continua no serviço.`);
        clearTimeout(uiRecoveryTimer);
        uiRecoveryTimer = setTimeout(() => { if (!shuttingDown && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload(); }, 1000);
    });
    mainWindow.on("unresponsive", () => {
        clearTimeout(uiRecoveryTimer);
        uiRecoveryTimer = setTimeout(() => { if (!shuttingDown && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.forcefullyCrashRenderer(); }, 15000);
    });
    mainWindow.on("responsive", () => clearTimeout(uiRecoveryTimer));

    mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
        if (!isTrustedRendererUrl(targetUrl)) event.preventDefault();
    });
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
    mainWindow.webContents.on("did-finish-load", () => service?.resetMonitor());
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


function registerTrustedHandle(channel) {
    ipcMain.handle(channel, async (event, ...args) => {
        if (!isTrustedIpcSender(event)) throw Error("Origem IPC nao autorizada.");
        if (shuttingDown) throw Error("O aplicativo está encerrando.");
        const result = await service.call(channel, args);
        if (["media:prepare-preview", "media:watch-source"].includes(channel) && result.ok && result.filePath) approvedPreviewPaths.add(await fs.promises.realpath(result.filePath));
        if (channel === "operation:save" && result.ok) configureWatchdog(result.settings);
        return result;
    });
}
function configureWatchdog(settings) {
    if (!app.isPackaged || process.platform !== "win32") return;
    watchdog ??= new ProcessWatchdog({ execPath: process.execPath, folder: app.getPath("userData"), cwd: path.dirname(process.execPath) });
    if (settings.watchdogEnabled) watchdog.start(); else watchdog.stop();
}
async function hostCall(action, args) {
    if (["showOpenDialog", "showSaveDialog", "showMessageBox"].includes(action)) return dialog[action](mainWindow ?? undefined, args);
    if (action === "openPath") return shell.openPath(args.file);
    if (action === "logoAsset") return logoAsset(args.style, args.profile);
    if (action === "validateWatermark") return validateWatermarkImage(args.filePath);
    if (action === "watermarkPreview") return createWatermarkPreviewDataUrl(args.filePath);
    if (action === "renderPdf") return require("../core/scheduling/rundown-pdf").renderRundownPdf(BrowserWindow, args.rundown);
    if (action === "controllerStatus") return controller.status();
    if (action === "controllerStart") return controller.start();
    if (action === "controllerStop") { controller.stop(); return controller.status(); }
    if (action === "loginSettings") { app.setLoginItemSettings(args); return true; }
    throw Error("Ação de host indisponível.");
}
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
app.on("second-instance", () => { if (mainWindow && !mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
app.whenReady().then(async () => {
    if (!locked) return;
    try {
        service = new ProgramServiceClient({
            fork: () => {
                const child = utilityProcess.fork(path.join(__dirname, "program-service-host.js"), [], {
                    serviceName: "SanTTos PROGRAM", stdio: "pipe", env: { ...process.env }
                });
                child.stdout?.on("data", chunk => process.stdout.write(chunk));
                child.stderr?.on("data", chunk => process.stderr.write(chunk)); return child;
            },
            config: { isPackaged: app.isPackaged, version: app.getVersion(), resourcesPath: process.resourcesPath,
                paths: Object.fromEntries(["userData", "appData", "cache", "documents"].map(name => [name, app.getPath(name)])) },
            hostCall,
            event: (channel, payload) => {
                if (!mainWindow || mainWindow.isDestroyed()) return;
                mainWindow.webContents.send(channel, payload);
                if (["playout:preview-frame", "playout:audio-pcm"].includes(channel)) return false;
            }
        });
        service.on("fault", message => console.error(message));
        service.on("relaunch", () => app.relaunch()); service.on("request-quit", () => app.quit());
        const unwrap = async (channel, args) => { const result = await service.call(channel, args); if (result.ok === false) throw Error(result.error); return result.rundown; };
        controller = new SchedulingWebController({ distFolder: path.join(__dirname, "../../dist"),
            resolveWatchSource: async id => { const result = await service.call('media:watch-source', [id]); if(!result.ok)throw Error(result.error);return result.filePath; },
            getMedia: () => service.call("service:media"), getCategories: () => service.call("library-categories:get"),
            getRundown: date => service.call("rundown:get", [date]), saveRundown: value => unwrap("rundown:save", [value]),
            getWeekly: weekday => service.call("rundown:weekly-get", [weekday]), saveWeekly: (weekday, value) => unwrap("rundown:weekly-save", [weekday, value]),
            renderPdf: value => require("../core/scheduling/rundown-pdf").renderRundownPdf(BrowserWindow, value) });
        await service.start();
        for (const channel of service.channels) registerTrustedHandle(channel);
        ipcMain.on("program:monitor-ack", (event, channel) => {
            if (isTrustedIpcSender(event) && ["playout:preview-frame", "playout:audio-pcm"].includes(channel)) service.monitorAck(channel);
        });
        // PROGRAM accepts frames only from its decoders, never from a renderer canvas.
        ipcMain.on("ndi:frame", () => {});
        protocol.handle(MEDIA_SCHEME, async request => serveImportedVideo(request, await service.call("service:media"), approvedPreviewPaths));
        protocol.handle(INPUT_PREVIEW_SCHEME, async request => serveWebInputPreview(request, await service.call("service:inputs"), { ffmpegPath: resolveMediaRuntime("ffmpeg") }));
        session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
        configureWatchdog((await service.call("operation:get")).settings); createWindow();
        app.on("activate", () => { if (!mainWindow && !shuttingDown) createWindow(); });
    } catch (error) { console.error("Falha fatal ao iniciar:", error); dialog.showErrorBox("SanTTos — inicialização bloqueada", error.message); app.exit(1); }
});
app.on("before-quit", async event => {
    if (quitCompleted) return; event.preventDefault(); if (shuttingDown) return;
    shuttingDown = true; clearTimeout(uiRecoveryTimer); controller?.stop(); watchdog?.stop();
    try { await service?.close(); }
    catch (error) { console.error("Falha ao encerrar o serviço PROGRAM:", error); }
    finally { quitCompleted = true; app.quit(); }
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
module.exports = { get programService() { return service; } };
