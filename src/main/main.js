const {
    app,
    BrowserWindow,
    ipcMain,
    dialog
} = require("electron");

const path = require("path");

const {
    initializeDatabase,
    addLog
} = require("../database/database");

const isDevelopment = !app.isPackaged;

function createWindow() {
    const win = new BrowserWindow({
        width: 1500,
        height: 900,

        minWidth: 1100,
        minHeight: 700,

        backgroundColor: "#0b0b0b",

        title: "Santtos TV Automation",

        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, "preload.js")
        }
    });

    if (isDevelopment) {
        win.loadURL("http://localhost:5173");
    } else {
        win.loadFile(
            path.join(__dirname, "../../dist/index.html")
        );
    }
}

function startSystem() {
    console.log("Inicializando Santtos TV Automation...");

    initializeDatabase();
    addLog("Sistema iniciado");

    console.log("Banco de dados OK");
}

ipcMain.handle("select-video", async () => {
    const result = await dialog.showOpenDialog({
        title: "Adicionar vídeo à biblioteca",

        properties: [
            "openFile",
            "multiSelections"
        ],

        filters: [
            {
                name: "Vídeos compatíveis",
                extensions: ["mp4", "mov"]
            }
        ]
    });

    if (result.canceled) {
        return [];
    }

    return result.filePaths;
});

app.whenReady().then(() => {
    startSystem();
    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
