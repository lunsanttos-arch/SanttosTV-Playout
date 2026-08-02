const {
    app,
    BrowserWindow,
    ipcMain,
    dialog
} = require("electron");

const path = require("path");

const {
    initializeDatabase,
    addLog,
    getMedia,
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

const isDevelopment =
    !app.isPackaged;

let mainWindow = null;

const analysesInProgress = new Map();

function createWindow() {
    mainWindow =
        new BrowserWindow({
            width: 1500,
            height: 900,

            minWidth: 1100,
            minHeight: 700,

            backgroundColor:
                "#0b0b0b",

            title:
                "Santtos TV Automation",

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

    mainWindow.on(
        "closed",
        () => {
            mainWindow = null;
        }
    );
}

async function analyzeMediaItem(mediaItem) {
    const existingAnalysis =
        analysesInProgress.get(mediaItem.id);

    if (existingAnalysis) {
        return existingAnalysis;
    }

    const analysisPromise =
        (async () => {
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
                    await probeMedia(
                        mediaItem.path
                    );

                updateMediaMetadata(
                    mediaItem.id,
                    {
                        ...metadata,

                        analysisCompletedAt:
                            new Date()
                                .toISOString()
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
                            new Date()
                                .toISOString()
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


async function analyzeMediaItems(
    mediaItems
) {
    await Promise.all(
        mediaItems.map(
            analyzeMediaItem
        )
    );

    return getMedia();
}

function registerIpcHandlers() {
    ipcMain.handle(
        "media:select",
        async () => {
            const result =
                await dialog
                    .showOpenDialog({
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
            const media =
                getMedia();

            const pendingMedia =
    media.filter(
        (item) =>
            item.status ===
                "pending-metadata"
    );

            if (
                pendingMedia.length >
                0
            ) {
                return analyzeMediaItems(
                    pendingMedia
                );
            }

            return media;
        }
    );

    ipcMain.handle(
        "media:import",
        async (
            _event,
            filePaths
        ) => {
            const importResult =
                addMedia(filePaths);

            const media =
                await analyzeMediaItems(
                    importResult
                        .importedItems
                );

            return {
                ...importResult,
                media
            };
        }
    );

    ipcMain.handle(
        "media:remove",
        async (
            _event,
            mediaId
        ) => {
            return removeMedia(
                mediaId
            );
        }
    );
}

function startSystem() {
    console.log(
        "Inicializando Santtos TV Automation..."
    );

    initializeDatabase();

    addLog(
        "Sistema iniciado"
    );

    console.log(
        "Banco de dados OK"
    );
}

app.whenReady().then(() => {
    startSystem();
    registerIpcHandlers();
    createWindow();

    app.on(
        "activate",
        () => {
            if (
                BrowserWindow
                    .getAllWindows()
                    .length === 0
            ) {
                createWindow();
            }
        }
    );
});

app.on(
    "window-all-closed",
    () => {
        if (
            process.platform !==
            "darwin"
        ) {
            app.quit();
        }
    }
);
