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
    removeMedia
} = require("../database/database");

const isDevelopment = !app.isPackaged;

let mainWindow = null;

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

            preload: path.join(
                __dirname,
                "preload.js"
            )
        }
    });

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

function registerIpcHandlers() {
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
            return getMedia();
        }
    );

    ipcMain.handle(
        "media:import",
        async (_event, filePaths) => {
            return addMedia(filePaths);
        }
    );

    ipcMain.handle(
        "media:remove",
        async (_event, mediaId) => {
            return removeMedia(mediaId);
        }
    );
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
    registerIpcHandlers();
    createWindow();

    app.on("activate", () => {
        if (
            BrowserWindow.getAllWindows()
                .length === 0
        ) {
            createWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
