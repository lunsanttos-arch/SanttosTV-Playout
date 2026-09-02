const {
    contextBridge,
    ipcRenderer
} = require("electron");

const {
    pathToFileURL
} = require("url");

contextBridge.exposeInMainWorld(
    "santtosAPI",
    {
        selectVideos: () =>
            ipcRenderer.invoke(
                "media:select"
            ),

        getMedia: () =>
            ipcRenderer.invoke(
                "media:list"
            ),

        importMedia: (filePaths) =>
            ipcRenderer.invoke(
                "media:import",
                filePaths
            ),

        removeMedia: (mediaId) =>
            ipcRenderer.invoke(
                "media:remove",
                mediaId
            ),

        getNdiStatus: () =>
            ipcRenderer.invoke(
                "ndi:status"
            ),

        playNdiFile: (filePath) =>
            ipcRenderer.invoke(
                "ndi:play-file",
                filePath
            ),

        stopNdiFile: () =>
            ipcRenderer.invoke(
                "ndi:stop-file"
            ),

        sendNdiFrame: (frameData) =>
            ipcRenderer.send(
                "ndi:frame",
                frameData
            ),

        getMediaFileUrl: (
            filePath
        ) =>
            pathToFileURL(
                filePath
            ).toString()
    }
);
