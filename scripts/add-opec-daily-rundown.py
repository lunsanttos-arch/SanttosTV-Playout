from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'anchor missing: {label}')
    return text.replace(old, new, 1)

# database.js
p = Path('src/database/database.js')
t = p.read_text(encoding='utf-8')

t = replace_once(
    t,
    '''    timeline: [],\n    playlists: [],\n    logs: []''',
    '''    timeline: [],\n    playlists: [],\n    dailyRundowns: {},\n    logs: []''',
    'database initial rundown'
)

t = replace_once(
    t,
    '''            playlists: Array.isArray(parsedData.playlists)\n                ? parsedData.playlists\n                : [],\n\n            logs: Array.isArray(parsedData.logs)''',
    '''            playlists: Array.isArray(parsedData.playlists)\n                ? parsedData.playlists\n                : [],\n\n            dailyRundowns:\n                parsedData.dailyRundowns &&\n                typeof parsedData.dailyRundowns === "object" &&\n                !Array.isArray(parsedData.dailyRundowns)\n                    ? parsedData.dailyRundowns\n                    : {},\n\n            logs: Array.isArray(parsedData.logs)''',
    'database load rundown'
)

anchor = '''function addMedia(filePaths) {'''
helpers = r'''function normalizeRundownDate(value) {
    const date = normalizeText(value, "", 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new TypeError("Data do roteiro inválida.");
    }
    return date;
}

function normalizeRundownTime(value) {
    const time = normalizeText(value, "06:00", 5);
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(time)
        ? time
        : "06:00";
}

function getDailyRundown(dateValue) {
    const date = normalizeRundownDate(dateValue);
    const stored = data.dailyRundowns?.[date] ?? {
        date,
        title: "Roteiro diário",
        startTime: "06:00",
        items: []
    };
    const mediaById = new Map(
        data.media.map((item) => [item.id, item])
    );

    const items = Array.isArray(stored.items)
        ? stored.items.map((entry) => {
              const source = mediaById.get(entry.sourceMediaId);
              if (!source) return null;
              return {
                  ...source,
                  rundownItemId: entry.rundownItemId,
                  sourceMediaId: entry.sourceMediaId,
                  blockLabel: normalizeText(entry.blockLabel, "", 80),
                  notes: normalizeText(entry.notes, "", 500),
                  watermark: Boolean(entry.watermark),
                  hashtag: normalizeHashtag(entry.hashtag ?? ""),
                  inPoint: normalizeClipNumber(entry.inPoint, 0),
                  outPoint: normalizeClipNumber(
                      entry.outPoint,
                      source.duration ?? 0
                  )
              };
          }).filter(Boolean)
        : [];

    return {
        date,
        title: normalizeText(stored.title, "Roteiro diário", 120) || "Roteiro diário",
        startTime: normalizeRundownTime(stored.startTime),
        items,
        updatedAt: stored.updatedAt ?? null
    };
}

function saveDailyRundown(rundown) {
    if (!rundown || typeof rundown !== "object") {
        throw new TypeError("Roteiro inválido.");
    }

    const date = normalizeRundownDate(rundown.date);
    const mediaIds = new Set(data.media.map((item) => item.id));
    const sourceItems = Array.isArray(rundown.items) ? rundown.items : [];

    const items = sourceItems.map((item) => {
        const sourceMediaId = item?.sourceMediaId ?? item?.id;
        if (typeof sourceMediaId !== "string" || !mediaIds.has(sourceMediaId)) {
            return null;
        }
        return {
            rundownItemId:
                typeof item.rundownItemId === "string" && item.rundownItemId
                    ? item.rundownItemId
                    : crypto.randomUUID(),
            sourceMediaId,
            blockLabel: normalizeText(item.blockLabel, "", 80),
            notes: normalizeText(item.notes, "", 500),
            watermark: Boolean(item.watermark),
            hashtag: normalizeHashtag(item.hashtag ?? ""),
            inPoint: normalizeClipNumber(item.inPoint, 0),
            outPoint: normalizeClipNumber(item.outPoint, item.duration ?? 0)
        };
    }).filter(Boolean);

    data.dailyRundowns = data.dailyRundowns ?? {};
    data.dailyRundowns[date] = {
        date,
        title: normalizeText(rundown.title, "Roteiro diário", 120) || "Roteiro diário",
        startTime: normalizeRundownTime(rundown.startTime),
        items,
        updatedAt: new Date().toISOString()
    };

    saveDatabase();
    return getDailyRundown(date);
}

''' + anchor

t = replace_once(t, anchor, helpers, 'database rundown functions')

t = replace_once(
    t,
    '''    getTimeline,\n    saveTimeline,\n    addMedia,''',
    '''    getTimeline,\n    saveTimeline,\n    getDailyRundown,\n    saveDailyRundown,\n    addMedia,''',
    'database rundown exports'
)
p.write_text(t, encoding='utf-8')

# main.js
p = Path('src/main/main.js')
t = p.read_text(encoding='utf-8')
t = replace_once(
    t,
    '''    getTimeline,\n    saveTimeline,\n    addMedia,''',
    '''    getTimeline,\n    saveTimeline,\n    getDailyRundown,\n    saveDailyRundown,\n    addMedia,''',
    'main rundown imports'
)

t = replace_once(
    t,
    '''    ipcMain.handle(\n        "timeline:list",\n        async () => getTimeline()\n    );''',
    '''    ipcMain.handle(\n        "rundown:get",\n        async (_event, date) => getDailyRundown(date)\n    );\n\n    ipcMain.handle(\n        "rundown:save",\n        async (_event, rundown) => {\n            try {\n                return {\n                    ok: true,\n                    rundown: saveDailyRundown(rundown)\n                };\n            } catch (error) {\n                console.error("Falha ao salvar roteiro diário:", error);\n                return {\n                    ok: false,\n                    error: error instanceof Error\n                        ? error.message\n                        : "Não foi possível salvar o roteiro."\n                };\n            }\n        }\n    );\n\n    ipcMain.handle(\n        "timeline:list",\n        async () => getTimeline()\n    );''',
    'main rundown ipc'
)
p.write_text(t, encoding='utf-8')

# preload.js
p = Path('src/main/preload.js')
t = p.read_text(encoding='utf-8')
t = replace_once(
    t,
    '''        getTimeline: () =>\n            ipcRenderer.invoke(\n                "timeline:list"\n            ),''',
    '''        getDailyRundown: (date) =>\n            ipcRenderer.invoke(\n                "rundown:get",\n                date\n            ),\n\n        saveDailyRundown: (rundown) =>\n            ipcRenderer.invoke(\n                "rundown:save",\n                rundown\n            ),\n\n        getTimeline: () =>\n            ipcRenderer.invoke(\n                "timeline:list"\n            ),''',
    'preload rundown api'
)
p.write_text(t, encoding='utf-8')

# App.tsx
p = Path('src/renderer/src/App.tsx')
t = p.read_text(encoding='utf-8')

t = replace_once(
    t,
    '''import BroadcastSettingsPanel from "./BroadcastSettingsPanel";''',
    '''import BroadcastSettingsPanel from "./BroadcastSettingsPanel";\nimport OpecSchedulerPanel from "./OpecSchedulerPanel";''',
    'App OPEC import'
)

t = replace_once(
    t,
    '''            getTimeline: () => Promise<MediaItem[]>;''',
    '''            getDailyRundown: (date: string) => Promise<{\n                date: string;\n                title: string;\n                startTime: string;\n                items: MediaItem[];\n                updatedAt?: string | null;\n            }>;\n            saveDailyRundown: (rundown: {\n                date: string;\n                title: string;\n                startTime: string;\n                items: MediaItem[];\n            }) => Promise<{\n                ok: boolean;\n                rundown: {\n                    date: string;\n                    title: string;\n                    startTime: string;\n                    items: MediaItem[];\n                };\n                error?: string;\n            }>;\n            getTimeline: () => Promise<MediaItem[]>;''',
    'App rundown API types'
)

t = replace_once(
    t,
    '''    const [programmedIndefinite, setProgrammedIndefinite] =\n        useState(false);''',
    '''    const [programmedIndefinite, setProgrammedIndefinite] =\n        useState(false);\n    const [rundownApplyRequest, setRundownApplyRequest] = useState<{\n        key: number;\n        items: MediaItem[];\n    } | null>(null);''',
    'App rundown apply state'
)

t = replace_once(
    t,
    '''                            onRemoveMedia={handleRemoveMedia}\n                            onScheduleSummary={(remainingSeconds, indefinite) => {''',
    '''                            onRemoveMedia={handleRemoveMedia}\n                            rundownApplyRequest={rundownApplyRequest}\n                            onScheduleSummary={(remainingSeconds, indefinite) => {''',
    'App playout rundown prop'
)

old = '''                    {activePanel === "settings" && (\n                        <BroadcastSettingsPanel\n                            hashtagStyle={hashtagStyle}\n                            onSaveHashtag={saveHashtagStyle}\n                        />\n                    )}\n\n                    {activePanel !== "playout" &&\n                        activePanel !== "settings" && ('''
new = '''                    {activePanel === "scheduler" && (\n                        <OpecSchedulerPanel\n                            media={media}\n                            onApply={(items) => {\n                                setRundownApplyRequest({\n                                    key: Date.now(),\n                                    items: items as MediaItem[]\n                                });\n                                setActivePanel("playout");\n                            }}\n                        />\n                    )}\n\n                    {activePanel === "settings" && (\n                        <BroadcastSettingsPanel\n                            hashtagStyle={hashtagStyle}\n                            onSaveHashtag={saveHashtagStyle}\n                        />\n                    )}\n\n                    {activePanel !== "playout" &&\n                        activePanel !== "settings" &&\n                        activePanel !== "scheduler" && ('''
t = replace_once(t, old, new, 'App scheduler render')

# Playout props

t = replace_once(
    t,
    '''    onRemoveMedia: (\n        media: MediaItem\n    ) => Promise<void>;\n    onScheduleSummary:''',
    '''    onRemoveMedia: (\n        media: MediaItem\n    ) => Promise<void>;\n    rundownApplyRequest: {\n        key: number;\n        items: MediaItem[];\n    } | null;\n    onScheduleSummary:''',
    'Playout rundown prop type'
)

t = replace_once(
    t,
    '''    onImportDroppedFiles,\n    onRemoveMedia,\n    onScheduleSummary\n}: PlayoutPanelProps) {''',
    '''    onImportDroppedFiles,\n    onRemoveMedia,\n    rundownApplyRequest,\n    onScheduleSummary\n}: PlayoutPanelProps) {''',
    'Playout rundown prop destructure'
)

anchor = '''    useEffect(() => {\n        if (!timelineLoadedRef.current) {\n            return;\n        }\n\n        const timer = window.setTimeout('''
insert = '''    useEffect(() => {\n        if (!rundownApplyRequest) {\n            return;\n        }\n\n        const prepared = rundownApplyRequest.items.map((item, index) => {\n            const sourceMediaId = item.sourceMediaId ?? item.id;\n            return {\n                ...item,\n                id: `${sourceMediaId}-rundown-${rundownApplyRequest.key}-${index}`,\n                sourceMediaId,\n                loop: false,\n                watermark: Boolean(item.watermark),\n                hashtag: item.hashtag ?? "",\n                inPoint: getClipIn(item),\n                outPoint: getClipOut(item)\n            };\n        });\n\n        if (prepared.length === 0) {\n            return;\n        }\n\n        if (isPlaying && selectedMedia) {\n            setTimelineQueue((current) => {\n                const currentIndex = current.findIndex(\n                    (item) => item.id === selectedMedia.id\n                );\n                const preserved = currentIndex >= 0\n                    ? current.slice(0, currentIndex + 1)\n                    : [selectedMedia];\n                return [...preserved, ...prepared];\n            });\n        } else {\n            setTimelineQueue(prepared);\n            onSelectMedia(prepared[0]);\n            setCurrentTime(getClipIn(prepared[0]));\n        }\n    }, [rundownApplyRequest]);\n\n''' + anchor

t = replace_once(t, anchor, insert, 'Playout rundown apply effect')
p.write_text(t, encoding='utf-8')

print('OPEC daily rundown integration applied')
