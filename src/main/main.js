const { app, BrowserWindow } = require("electron");
const path = require("path");

function createWindow() {

    const win = new BrowserWindow({
        width: 1400,
        height: 850,
        minWidth: 1000,
        minHeight: 600,

        backgroundColor: "#111111",

        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        },

        title: "Santtos TV Automation"
    });


    win.loadFile(
        path.join(__dirname, "../renderer/index.html")
    );

}


app.whenReady().then(() => {

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
