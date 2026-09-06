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

        updateMediaHashtag: (
            mediaId,
            hashtag
        ) =>
            ipcRenderer.invoke(
                "media:set-hashtag",
                mediaId,
                hashtag
            ),

        getTimeline: () =>
            ipcRenderer.invoke(
                "timeline:list"
            ),

        saveTimeline: (timelineItems) =>
            ipcRenderer.invoke(
                "timeline:save",
                timelineItems
            ),

        getNdiStatus: () =>
            ipcRenderer.invoke(
                "ndi:status"
            ),

        playNdiFile: (
            filePath,
            startSeconds = 0,
            hashtag = ""
        ) =>
            ipcRenderer.invoke(
                "ndi:play-file",
                filePath,
                startSeconds,
                hashtag
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
