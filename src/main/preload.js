const {
    contextBridge,
    ipcRenderer,
    webUtils
} = require("electron");

// Acknowledge transport delivery even when the React monitor is not mounted.
// Credits belong to the renderer connection, not to individual UI subscribers.
// A frozen renderer still cannot ACK, so bounded backpressure is preserved.
for (const channel of ["playout:preview-frame", "playout:audio-pcm"]) {
    ipcRenderer.on(channel, () => ipcRenderer.send("program:monitor-ack", channel));
}

// Sandboxed preload: Node modules from project files are intentionally unavailable.
const buildMediaUrl = (filePath) =>
    typeof filePath === "string" && filePath.length <= 4096
        ? `santtos-media://local/video?path=${encodeURIComponent(filePath)}`
        : "";

contextBridge.exposeInMainWorld(
    "santtosAPI",
    {
        getOperationSettings: () => ipcRenderer.invoke("operation:get"),
        getProgramMonitorClock: () => ipcRenderer.invoke("program:monitor-clock"),
        saveOperationSettings: settings => ipcRenderer.invoke("operation:save", settings),
        exportDiagnostics: () => ipcRenderer.invoke("operation:diagnostics"),
        advanceNativeRundown: () => ipcRenderer.invoke("playout:next"),
        updateNativeItemFlags: (id, flags) => ipcRenderer.invoke("playout:flags", id, flags),
        applyNativeRundown: (items, context) => ipcRenderer.invoke("playout:apply-rundown", items, context),
        getDataBackupStatus: () => ipcRenderer.invoke("backup:status"),
        saveDataBackupSettings: settings => ipcRenderer.invoke("backup:settings", settings),
        chooseDataBackupFolder: () => ipcRenderer.invoke("backup:folder"),
        clearDataBackupFolder: () => ipcRenderer.invoke("backup:clear-folder"),
        createDataBackup: () => ipcRenderer.invoke("backup:create"),
        openDataBackupFolder: () => ipcRenderer.invoke("backup:open-folder"),
        exportDataBackup: () => ipcRenderer.invoke("backup:export"),
        inspectDataBackup: () => ipcRenderer.invoke("backup:inspect"),
        restoreDataBackup: () => ipcRenderer.invoke("backup:restore"),
        getControllerStatus: () => ipcRenderer.invoke("controller:status"),
        setControllerEnabled: (enabled) => ipcRenderer.invoke("controller:set-enabled", enabled),
        getReportFiles: () => ipcRenderer.invoke("report:list"),
        openReport: (date) => ipcRenderer.invoke("report:open", date),
        getPlayoutRecovery: () => ipcRenderer.invoke("playout:recovery"),
        savePlayoutCheckpoint: (checkpoint) => ipcRenderer.invoke("playout:checkpoint", checkpoint),
        selectVideos: () =>
            ipcRenderer.invoke(
                "media:select"
            ),

        getLibraryWatchSource: id => ipcRenderer.invoke("media:watch-source",id),
        getMediaAnalysisStatus: () => ipcRenderer.invoke("media:analysis-status"),
        openLibraryFile: id => ipcRenderer.invoke("media:watch-external",id),
        recheckMedia: id => ipcRenderer.invoke("media:analyze",id),
        onMediaChanged: callback => { const listener=()=>callback(); ipcRenderer.on("media:changed",listener); return ()=>ipcRenderer.removeListener("media:changed",listener); },
        getMedia: () =>
            ipcRenderer.invoke(
                "media:list"
            ),

        importRundownFiles: paths => ipcRenderer.invoke("rundown:import-files", paths),

        importMedia: (filePaths) =>
            ipcRenderer.invoke(
                "media:import",
                filePaths
            ),

        prepareMediaPreview: (filePath) =>
            ipcRenderer.invoke(
                "media:prepare-preview",
                filePath
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

        getWeeklyRundown: weekday => ipcRenderer.invoke("rundown:weekly-get", weekday),
        saveWeeklyRundown: (weekday, rundown) => ipcRenderer.invoke("rundown:weekly-save", weekday, rundown),
        exportRundownHtml: rundown => ipcRenderer.invoke("rundown:html", rundown),
        exportRundownPdf: rundown => ipcRenderer.invoke("rundown:pdf", rundown),
        getDailyRundown: (date) =>
            ipcRenderer.invoke(
                "rundown:get",
                date
            ),

        saveDailyRundown: (rundown) =>
            ipcRenderer.invoke(
                "rundown:save",
                rundown
            ),

        getWebInputs: () =>
            ipcRenderer.invoke(
                "web-inputs:get"
            ),

        getVlcInputStatus: () =>
            ipcRenderer.invoke(
                "web-inputs:vlc-status"
            ),

        saveWebInput: (input) =>
            ipcRenderer.invoke(
                "web-inputs:save",
                input
            ),

        removeWebInput: (id) =>
            ipcRenderer.invoke(
                "web-inputs:remove",
                id
            ),

        getServerMediaSettings: () =>
            ipcRenderer.invoke(
                "server-media:get-settings"
            ),

        saveServerMediaSettings: (settings) =>
            ipcRenderer.invoke(
                "server-media:set-settings",
                settings
            ),

        selectServerMediaRoot: () =>
            ipcRenderer.invoke(
                "server-media:select-root"
            ),

        prepareServerMedia: (filePath) =>
            ipcRenderer.invoke(
                "server-media:prepare",
                filePath
            ),

        clearServerMediaCache: () =>
            ipcRenderer.invoke(
                "server-media:clear-cache"
            ),

        getLibraryCategories: () =>
            ipcRenderer.invoke(
                "library-categories:get"
            ),

        saveLibraryCategories: async (categories) => {
            const currentCategories =
                await ipcRenderer.invoke(
                    "library-categories:get"
                );
            const currentIds = new Set(
                Array.isArray(currentCategories)
                    ? currentCategories.map(
                          (category) => category.id
                      )
                    : []
            );
            const preparedCategories =
                Array.isArray(categories)
                    ? categories.map(
                          (category) => ({
                              ...category
                          })
                      )
                    : [];
            const newUnconfiguredCategory =
                preparedCategories.find(
                    (category) =>
                        !currentIds.has(category.id) &&
                        !category.builtIn &&
                        !String(
                            category.folderPath ?? ""
                        ).trim()
                );

            if (newUnconfiguredCategory) {
                const folderResult =
                    await ipcRenderer.invoke(
                        "library-categories:select-folder"
                    );

                if (
                    !folderResult?.ok ||
                    !folderResult.folderPath
                ) {
                    return {
                        ok: false,
                        canceled: Boolean(
                            folderResult?.canceled
                        ),
                        error:
                            "Criação cancelada: selecione uma pasta para a nova aba."
                    };
                }

                newUnconfiguredCategory.folderPath =
                    folderResult.folderPath;
            }

            return ipcRenderer.invoke(
                "library-categories:save",
                preparedCategories
            );
        },

        selectLibraryFolder: () =>
            ipcRenderer.invoke(
                "library-categories:select-folder"
            ),

        scanLibraryCategory: (categoryId) =>
            ipcRenderer.invoke(
                "library-categories:scan",
                categoryId
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
        onNativeRundownChanged: callback => {
            const listener = (_event, payload) => callback(payload);
            ipcRenderer.on("playout:rundown-changed", listener);
            return () => ipcRenderer.removeListener("playout:rundown-changed", listener);
        },

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

        saveExhibitionStyle: (style) =>
            ipcRenderer.invoke(
                "settings:set-exhibition-style",
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

        updateProgramGraphics: update => ipcRenderer.invoke("playout:graphics", update),
        getNdiStatus: () =>
            ipcRenderer.invoke(
                "ndi:status"
            ),

        prepareNdiInput: (
            filePath,
            overlayState = {}
        ) =>
            ipcRenderer.invoke(
                "ndi:prepare-input",
                filePath,
                overlayState
            ),

        cancelPreparedNdiInput: () =>
            ipcRenderer.invoke(
                "ndi:cancel-prepared-input"
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

        pauseNdiFile: () =>
            ipcRenderer.invoke(
                "playout:pause"
            ),

        seekNdiFile: (positionSeconds) =>
            ipcRenderer.invoke(
                "playout:seek",
                positionSeconds
            ),

        stopNdiFile: () =>
            ipcRenderer.invoke(
                "ndi:stop-file"
            ),

        onNativePlayoutEnded: (callback) => {
            if (typeof callback !== "function") {
                return () => {};
            }

            const listener = (_event, payload) =>
                callback(payload);

            ipcRenderer.on(
                "playout:native-ended",
                listener
            );

            return () =>
                ipcRenderer.removeListener(
                    "playout:native-ended",
                    listener
                );
        },

        onProgramAudioPcm: (callback) => {
            if (typeof callback !== "function") {
                return () => {};
            }

            const listener = (_event, payload) => callback(payload);

            ipcRenderer.on(
                "playout:audio-pcm",
                listener
            );

            return () =>
                ipcRenderer.removeListener(
                    "playout:audio-pcm",
                    listener
                );
        },

        onProgramAudioReset: (callback) => {
            if (typeof callback !== "function") {
                return () => {};
            }

            const listener = (_event, payload) =>
                callback(payload);

            ipcRenderer.on(
                "playout:audio-reset",
                listener
            );

            return () =>
                ipcRenderer.removeListener(
                    "playout:audio-reset",
                    listener
                );
        },

        onProgramPreviewFrame: (callback) => {
            if (typeof callback !== "function") {
                return () => {};
            }

            const listener = (_event, payload) => callback(payload);

            ipcRenderer.on(
                "playout:preview-frame",
                listener
            );

            return () =>
                ipcRenderer.removeListener(
                    "playout:preview-frame",
                    listener
                );
        },

        onProgramPreviewReset: (callback) => {
            if (typeof callback !== "function") {
                return () => {};
            }

            const listener = (_event, payload) =>
                callback(payload);

            ipcRenderer.on(
                "playout:preview-reset",
                listener
            );

            return () =>
                ipcRenderer.removeListener(
                    "playout:preview-reset",
                    listener
                );
        },

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

        selectPlayoutReportFolder: () =>
            ipcRenderer.invoke(
                "report:select-folder"
            ),

        resetPlayoutReportFolder: () =>
            ipcRenderer.invoke(
                "report:reset-folder"
            ),

        sendNdiFrame: (frameData) =>
            ipcRenderer.send(
                "ndi:frame",
                frameData
            ),

        getMediaFileUrl: (
            filePath
        ) =>
            buildMediaUrl(filePath)
    }
);
