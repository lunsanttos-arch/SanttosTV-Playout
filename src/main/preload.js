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

        getMediaFileUrl: (
            filePath
        ) =>
            pathToFileURL(
                filePath
            ).toString()
    }
);
