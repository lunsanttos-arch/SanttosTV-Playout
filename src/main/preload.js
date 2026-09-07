const {
    contextBridge,
    ipcRenderer,
    webUtils
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

        getDroppedFilePath: (file) => {
            try {
                return webUtils.getPathForFile(file);
            } catch {
                return "";
            }
        },

        removeMedia: (mediaId) =>
            ipcRenderer.invoke(
                "media:remove",
                mediaId
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

        getSettings: () =>
            ipcRenderer.invoke(
                "settings:get"
            ),

        saveOutputSettings: (output) =>
            ipcRenderer.invoke(
                "settings:set-output",
                output
            ),

        saveHashtagStyle: (style) =>
            ipcRenderer.invoke(
                "settings:set-hashtag-style",
                style
            ),

        selectWatermark: () =>
            ipcRenderer.invoke(
                "watermark:select"
            ),

        getWatermarkPreview: (filePath) =>
            ipcRenderer.invoke(
                "watermark:preview",
                filePath
            ),

        saveWatermarkStyle: (style) =>
            ipcRenderer.invoke(
                "settings:set-watermark-style",
                style
            ),

        getNdiStatus: () =>
            ipcRenderer.invoke(
                "ndi:status"
            ),

        playNdiFile: (
            filePath,
            startSeconds = 0,
            hashtag = "",
            overlayState = {}
        ) =>
            ipcRenderer.invoke(
                "ndi:play-file",
                filePath,
                startSeconds,
                hashtag,
                overlayState
            ),

        stopNdiFile: () =>
            ipcRenderer.invoke(
                "ndi:stop-file"
            ),

        startPlayoutReport: (mediaItem) =>
            ipcRenderer.invoke(
                "report:playout-start",
                mediaItem
            ),

        finishPlayoutReport: (entryId, status, playedSeconds) =>
            ipcRenderer.invoke(
                "report:playout-finish",
                entryId,
                status,
                playedSeconds
            ),

        getPlayoutReportFolder: () =>
            ipcRenderer.invoke(
                "report:folder"
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
