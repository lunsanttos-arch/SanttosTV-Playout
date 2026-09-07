from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'anchor missing: {label}')
    return text.replace(old, new, 1)

# main.js
p = Path('src/main/main.js')
t = p.read_text(encoding='utf-8')

t = replace_once(
    t,
    '''const {\n    checkMediaDecode\n} = require(\n    "../core/media/decode-check"\n);''',
    '''const {\n    checkMediaDecode\n} = require(\n    "../core/media/decode-check"\n);\n\nconst {\n    initializePlayoutReports,\n    startPlayoutEntry,\n    finishPlayoutEntry,\n    closeOpenEntriesAsSkipped,\n    getReportFolder\n} = require(\n    "../core/reporting/playout-report"\n);''',
    'main report import'
)

t = replace_once(
    t,
    '''    ipcMain.handle(\n        "timeline:list",\n        async () => getTimeline()\n    );''',
    '''    ipcMain.handle(\n        "report:playout-start",\n        async (_event, mediaItem) => {\n            try {\n                return {\n                    ok: true,\n                    ...startPlayoutEntry(mediaItem)\n                };\n            } catch (error) {\n                console.error(\n                    "Falha ao iniciar registro de exibição:",\n                    error\n                );\n                return {\n                    ok: false,\n                    error: error instanceof Error\n                        ? error.message\n                        : "Não foi possível iniciar o registro de exibição."\n                };\n            }\n        }\n    );\n\n    ipcMain.handle(\n        "report:playout-finish",\n        async (_event, entryId, status, playedSeconds) => {\n            try {\n                return finishPlayoutEntry(\n                    entryId,\n                    status,\n                    playedSeconds\n                );\n            } catch (error) {\n                console.error(\n                    "Falha ao finalizar registro de exibição:",\n                    error\n                );\n                return {\n                    ok: false,\n                    error: error instanceof Error\n                        ? error.message\n                        : "Não foi possível finalizar o registro de exibição."\n                };\n            }\n        }\n    );\n\n    ipcMain.handle(\n        "report:folder",\n        async () => ({\n            ok: true,\n            folder: getReportFolder()\n        })\n    );\n\n    ipcMain.handle(\n        "timeline:list",\n        async () => getTimeline()\n    );''',
    'main report ipc'
)

t = replace_once(
    t,
    '''    initializeDatabase();\n    addLog("Sistema iniciado");\n\n    console.log("Banco de dados OK");''',
    '''    initializeDatabase();\n    initializePlayoutReports({\n        userDataPath: app.getPath("userData"),\n        documentsPath: app.getPath("documents")\n    });\n    addLog("Sistema iniciado");\n\n    console.log("Banco de dados OK");\n    console.log(\n        `Relatórios de exibição: ${getReportFolder()}`\n    );''',
    'main report init'
)

t = replace_once(
    t,
    '''app.on("before-quit", () => {\n    stopNativePlayback();\n    stopNdiSender();\n});''',
    '''app.on("before-quit", () => {\n    closeOpenEntriesAsSkipped();\n    stopNativePlayback();\n    stopNdiSender();\n});''',
    'main shutdown close report'
)

p.write_text(t, encoding='utf-8')

# preload.js
p = Path('src/main/preload.js')
t = p.read_text(encoding='utf-8')

t = replace_once(
    t,
    '''        stopNdiFile: () =>\n            ipcRenderer.invoke(\n                "ndi:stop-file"\n            ),\n\n        sendNdiFrame:''',
    '''        stopNdiFile: () =>\n            ipcRenderer.invoke(\n                "ndi:stop-file"\n            ),\n\n        startPlayoutReport: (mediaItem) =>\n            ipcRenderer.invoke(\n                "report:playout-start",\n                mediaItem\n            ),\n\n        finishPlayoutReport: (entryId, status, playedSeconds) =>\n            ipcRenderer.invoke(\n                "report:playout-finish",\n                entryId,\n                status,\n                playedSeconds\n            ),\n\n        getPlayoutReportFolder: () =>\n            ipcRenderer.invoke(\n                "report:folder"\n            ),\n\n        sendNdiFrame:''',
    'preload report api'
)

p.write_text(t, encoding='utf-8')

# App.tsx
p = Path('src/renderer/src/App.tsx')
t = p.read_text(encoding='utf-8')

t = replace_once(
    t,
    '''            stopNdiFile: () => Promise<NdiCommandResult>;\n            sendNdiFrame:''',
    '''            stopNdiFile: () => Promise<NdiCommandResult>;\n            startPlayoutReport: (\n                mediaItem: MediaItem & {\n                    plannedDurationSeconds: number;\n                }\n            ) => Promise<{\n                ok: boolean;\n                id?: string;\n                error?: string;\n            }>;\n            finishPlayoutReport: (\n                entryId: string,\n                status: "EXECUTADO" | "PULADO",\n                playedSeconds: number\n            ) => Promise<{\n                ok: boolean;\n                error?: string;\n            }>;\n            getPlayoutReportFolder: () => Promise<{\n                ok: boolean;\n                folder?: string;\n            }>;\n            sendNdiFrame:''',
    'renderer report api type'
)

t = replace_once(
    t,
    '''    const [editingFilm, setEditingFilm] =\n        useState<MediaItem | null>(null);\n    const clipAdvanceGuardRef = useRef(false);''',
    '''    const [editingFilm, setEditingFilm] =\n        useState<MediaItem | null>(null);\n    const clipAdvanceGuardRef = useRef(false);\n    const activeReportIdRef = useRef<string | null>(null);''',
    'renderer active report ref'
)

anchor = '''    async function startNativeNdi(\n        mediaItem: MediaItem,\n        startSeconds = 0,\n        continuousSelf = false\n    ) {'''
helpers = '''    async function startExecutionReport(mediaItem: MediaItem) {\n        if (activeReportIdRef.current) {\n            return;\n        }\n\n        try {\n            const result = await window.santtosAPI.startPlayoutReport({\n                ...mediaItem,\n                inPoint: getClipIn(mediaItem),\n                outPoint: getClipOut(mediaItem),\n                plannedDurationSeconds: getClipDuration(mediaItem)\n            });\n\n            if (result.ok && result.id) {\n                activeReportIdRef.current = result.id;\n            } else if (!result.ok) {\n                console.error(\n                    "Não foi possível iniciar o relatório de exibição:",\n                    result.error\n                );\n            }\n        } catch (error) {\n            console.error(\n                "Erro no relatório de exibição:",\n                error\n            );\n        }\n    }\n\n    async function finishExecutionReport(\n        status: "EXECUTADO" | "PULADO",\n        mediaItem: MediaItem | null = selectedMedia,\n        forcedPlayedSeconds?: number\n    ) {\n        const reportId = activeReportIdRef.current;\n        if (!reportId) {\n            return;\n        }\n\n        activeReportIdRef.current = null;\n\n        const videoTime = videoRef.current?.currentTime ?? currentTime;\n        const playedSeconds = forcedPlayedSeconds ?? Math.max(\n            0,\n            videoTime - getClipIn(mediaItem)\n        );\n\n        try {\n            const result = await window.santtosAPI.finishPlayoutReport(\n                reportId,\n                status,\n                playedSeconds\n            );\n            if (!result.ok) {\n                console.error(\n                    "Não foi possível finalizar o relatório de exibição:",\n                    result.error\n                );\n            }\n        } catch (error) {\n            console.error(\n                "Erro ao finalizar relatório de exibição:",\n                error\n            );\n        }\n    }\n\n''' + anchor

t = replace_once(t, anchor, helpers, 'renderer report helpers')

t = replace_once(
    t,
    '''            await video.play();\n            setIsPlaying(true);\n        } catch (error) {''',
    '''            await video.play();\n            setIsPlaying(true);\n            await startExecutionReport(mediaToPlay);\n        } catch (error) {''',
    'renderer initial report start'
)

t = replace_once(
    t,
    '''    async function stopVideo() {\n        await window.santtosAPI.stopNdiFile();''',
    '''    async function stopVideo() {\n        await finishExecutionReport("PULADO");\n        await window.santtosAPI.stopNdiFile();''',
    'renderer stop skipped'
)

t = replace_once(
    t,
    '''    async function playNextMedia() {\n        if (selectedMedia?.loop) {''',
    '''    async function playNextMedia(\n        reason: "completed" | "skipped" = "skipped"\n    ) {\n        await finishExecutionReport(\n            reason === "completed" ? "EXECUTADO" : "PULADO",\n            selectedMedia,\n            reason === "completed"\n                ? getClipDuration(selectedMedia)\n                : undefined\n        );\n\n        if (selectedMedia?.loop) {''',
    'renderer next finish status'
)

# First occurrence inside loop branch only.
t = replace_once(
    t,
    '''            await video.play();\n            setIsPlaying(true);\n            return;\n        }\n\n        if (!nextMedia) {''',
    '''            await video.play();\n            setIsPlaying(true);\n            await startExecutionReport(selectedMedia);\n            return;\n        }\n\n        if (!nextMedia) {''',
    'renderer loop report restart'
)

# Next media branch
needle = '''        await startNativeNdi(nextMedia, nextIn);\n        await video.play();\n        setIsPlaying(true);\n    }'''
replacement = '''        await startNativeNdi(nextMedia, nextIn);\n        await video.play();\n        setIsPlaying(true);\n        await startExecutionReport(nextMedia);\n    }'''
t = replace_once(t, needle, replacement, 'renderer next report start')

t = replace_once(
    t,
    '''            await playNextMedia();\n        }\n    }\n\n    async function handleSeeked''',
    '''            await playNextMedia("completed");\n        }\n    }\n\n    async function handleSeeked''',
    'renderer natural out status'
)

# UI button and ended callback
if 'onClick={playNextMedia}' not in t:
    raise SystemExit('anchor missing: next button')
t = t.replace(
    'onClick={playNextMedia}',
    'onClick={() => playNextMedia("skipped")}',
    1
)
if 'onEnded={playNextMedia}' not in t:
    raise SystemExit('anchor missing: video ended callback')
t = t.replace(
    'onEnded={playNextMedia}',
    'onEnded={() => playNextMedia("completed")}',
    1
)

p.write_text(t, encoding='utf-8')
print('Daily playout report integration applied')
