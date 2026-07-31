const {
    contextBridge,
    ipcRenderer
} = require("electron");

contextBridge.exposeInMainWorld("santtosAPI", {
    selectVideos: () => ipcRenderer.invoke("select-video")
});
