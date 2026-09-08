import {
    useEffect,
    useMemo,
    useRef,
    useState
} from "react";
import type { CSSProperties } from "react";
import BroadcastSettingsPanel from "./BroadcastSettingsPanel";
import OpecSchedulerPanel from "./OpecSchedulerPanel";

type Panel =
    | "playout"
    | "library"
    | "playlist"
    | "scheduler"
    | "settings";

interface MediaItem {
    id: string;
    sourceMediaId?: string;
    loop?: boolean;
    watermark?: boolean;
    hashtag?: string;
    inPoint?: number;
    outPoint?: number | null;
    blockLabel?: string;
    name: string;
    path: string;
    extension: string;
    fileSize: number;
    duration: number | null;
    width: number | null;
    height: number | null;
    fps: number | null;
    videoCodec: string | null;
    audioCodec: string | null;
    videoStreamIndex?: number | null;
    audioStreamIndex?: number | null;
    timingMode?: "cfr" | "vfr" | "unknown";
    isVariableFrameRate?: boolean;
    rotation?: number;
    sampleAspectRatio?: string | null;
    decoderMode?: "hardware" | "software" | "unavailable";
    thumbnail: string | null;
    status: string;
    createdAt: string;
}

interface WatermarkStyle {
    filePath: string;
    widthPx: number;
    x: number;
    y: number;
    opacity: number;
    fadeMs: number;
}

interface HashtagStyle {
    fontFamily: string;
    fontSize: number;
    color: string;
    opacity: number;
    x: number;
    y: number;
    bold: boolean;
    outlineWidth: number;
    outlineColor: string;
    outlineOpacity: number;
    shadowEnabled: boolean;
    shadowColor: string;
    shadowOpacity: number;
    shadowX: number;
    shadowY: number;
}

interface AppSettings {
    channelName: string;
    resolution: string;
    fps: string;
    ndiName: string;
    watermarkStyle: WatermarkStyle;
    hashtagStyle: HashtagStyle;
}

interface ImportResult {
    importedItems: MediaItem[];
    duplicatedItems: string[];
    media: MediaItem[];
}

interface RemoveResult {
    removed: boolean;
    removedItem?: MediaItem;
    media: MediaItem[];
    timeline?: MediaItem[];
}

interface NdiCommandResult {
    ok: boolean;
    error?: string;
    filePath?: string;
    startSeconds?: number;
}

interface SaveHashtagStyleResult {
    ok: boolean;
    hashtagStyle: HashtagStyle;
}

interface LibraryCategory {
    id: string;
    name: string;
    folderPath: string;
    builtIn?: boolean;
}

const DEFAULT_WATERMARK_STYLE: WatermarkStyle = {
    filePath: "",
    widthPx: 180,
    x: 1680,
    y: 40,
    opacity: 0.82,
    fadeMs: 200
};

const DEFAULT_HASHTAG_STYLE: HashtagStyle = {
    fontFamily: "Arial",
    fontSize: 28,
    color: "#ffffff",
    opacity: 0.68,
    x: 55,
    y: 32,
    bold: true,
    outlineWidth: 1,
    outlineColor: "#000000",
    outlineOpacity: 0.35,
    shadowEnabled: true,
    shadowColor: "#000000",
    shadowOpacity: 0.35,
    shadowX: 2,
    shadowY: 2
};

declare global {
    interface Window {
        santtosAPI: {
            selectVideos: () => Promise<string[]>;
            getMedia: () => Promise<MediaItem[]>;
            importMedia: (
                filePaths: string[]
            ) => Promise<ImportResult>;
            getDroppedFilePath: (file: File) => string;
            removeMedia: (
                mediaId: string
            ) => Promise<RemoveResult>;
            getDailyRundown: (date: string) => Promise<{
                date: string;
                title: string;
                startTime: string;
                items: MediaItem[];
                updatedAt?: string | null;
            }>;
            saveDailyRundown: (rundown: {
                date: string;
                title: string;
                startTime: string;
                items: MediaItem[];
            }) => Promise<{
                ok: boolean;
                rundown: {
                    date: string;
                    title: string;
                    startTime: string;
                    items: MediaItem[];
                };
                error?: string;
            }>;
            getLibraryCategories: () => Promise<LibraryCategory[]>;
            saveLibraryCategories: (categories: LibraryCategory[]) => Promise<{
                ok: boolean;
                categories?: LibraryCategory[];
                error?: string;
            }>;
            selectLibraryFolder: () => Promise<{
                ok: boolean;
                canceled?: boolean;
                folderPath?: string;
            }>;
            scanLibraryCategory: (categoryId: string) => Promise<{
                ok: boolean;
                category?: LibraryCategory;
                filePaths?: string[];
                folderMissing?: boolean;
                unconfigured?: boolean;
                error?: string;
            }>;
            getTimeline: () => Promise<MediaItem[]>;
            saveTimeline: (
                timelineItems: MediaItem[]
            ) => Promise<MediaItem[]>;
            getSettings: () => Promise<AppSettings>;
            saveHashtagStyle: (
                style: HashtagStyle
            ) => Promise<SaveHashtagStyleResult>;
            getNdiStatus: () => Promise<{
                online: boolean;
                source: string;
                nativePlaybackActive?: boolean;
            }>;
            playNdiFile: (
                filePath: string,
                startSeconds?: number,
                hashtag?: string,
                overlayState?: {
                    durationSeconds?: number;
                    watermarkEnabled?: boolean;
                    watermarkFadeIn?: boolean;
                    watermarkFadeOut?: boolean;
                    hashtagFadeIn?: boolean;
                    hashtagFadeOut?: boolean;
                    videoStreamIndex?: number | null;
                    audioStreamIndex?: number | null;
                    timingMode?: string;
                    outPointSeconds?: number | null;
                }
            ) => Promise<NdiCommandResult>;
            getWatermarkPreview: (
                filePath: string
            ) => Promise<{
                ok: boolean;
                dataUrl?: string;
                error?: string;
            }>;
            stopNdiFile: () => Promise<NdiCommandResult>;
            startPlayoutReport: (
                mediaItem: MediaItem & {
                    plannedDurationSeconds: number;
                }
            ) => Promise<{
                ok: boolean;
                id?: string;
                error?: string;
            }>;
            finishPlayoutReport: (
                entryId: string,
                status: "EXECUTADO" | "PULADO",
                playedSeconds: number
            ) => Promise<{
                ok: boolean;
                error?: string;
            }>;
            getPlayoutReportFolder: () => Promise<{
                ok: boolean;
                folder?: string;
            }>;
            sendNdiFrame: (
                frameData: Uint8Array
            ) => void;
            getMediaFileUrl: (
                filePath: string
            ) => string;
        };
    }
}

export default function App() {
    const [clock, setClock] =
        useState("00:00:00");
    const [ndiOnline, setNdiOnline] =
        useState(false);
    const [activePanel, setActivePanel] =
        useState<Panel>("playout");
    const [media, setMedia] =
        useState<MediaItem[]>([]);
    const [isLoading, setIsLoading] =
        useState(false);
    const [message, setMessage] =
        useState("");
    const [selectedMedia, setSelectedMedia] =
        useState<MediaItem | null>(null);
    const [hashtagStyle, setHashtagStyle] =
        useState<HashtagStyle>(
            DEFAULT_HASHTAG_STYLE
        );
    const [programmedRemainingSeconds, setProgrammedRemainingSeconds] =
        useState(0);
    const [programmedIndefinite, setProgrammedIndefinite] =
        useState(false);
    const [rundownApplyRequest, setRundownApplyRequest] = useState<{
        key: number;
        items: MediaItem[];
    } | null>(null);

    useEffect(() => {
        const updateClock = () =>
            setClock(
                new Date().toLocaleTimeString(
                    "pt-BR"
                )
            );

        updateClock();
        const timer = window.setInterval(
            updateClock,
            1000
        );

        return () =>
            window.clearInterval(timer);
    }, []);

    useEffect(() => {
        const updateNdiStatus = async () => {
            try {
                const status =
                    await window.santtosAPI
                        .getNdiStatus();
                setNdiOnline(status.online);
            } catch {
                setNdiOnline(false);
            }
        };

        updateNdiStatus();
        const timer = window.setInterval(
            updateNdiStatus,
            1000
        );

        return () =>
            window.clearInterval(timer);
    }, []);

    useEffect(() => {
        Promise.all([
            window.santtosAPI.getMedia(),
            window.santtosAPI.getSettings()
        ])
            .then(([savedMedia, settings]) => {
                setMedia(savedMedia);
                setHashtagStyle(
                    settings.hashtagStyle ??
                        DEFAULT_HASHTAG_STYLE
                );
            })
            .catch((error) => {
                console.error(error);
                setMessage(
                    "Não foi possível carregar as configurações do sistema."
                );
            });
    }, []);

    async function addVideos() {
        try {
            setMessage("");
            const selectedFiles =
                await window.santtosAPI
                    .selectVideos();

            if (selectedFiles.length === 0) {
                return;
            }

            setIsLoading(true);
            const result =
                await window.santtosAPI
                    .importMedia(selectedFiles);

            setMedia(result.media);

            if (result.importedItems.length > 0) {
                setMessage(
                    `${result.importedItems.length} vídeo(s) adicionado(s) à biblioteca. Use + Timeline para programar.`
                );
            } else if (
                result.duplicatedItems.length > 0
            ) {
                setMessage(
                    "Os vídeos selecionados já estavam cadastrados."
                );
            }
        } catch (error) {
            console.error(error);
            setMessage(
                "Ocorreu um erro durante a importação."
            );
        } finally {
            setIsLoading(false);
        }
    }

    async function importDroppedFiles(
        filePaths: string[]
    ): Promise<ImportResult> {
        if (filePaths.length === 0) {
            return {
                importedItems: [],
                duplicatedItems: [],
                media
            };
        }

        setIsLoading(true);
        setMessage("");
        try {
            const result =
                await window.santtosAPI.importMedia(filePaths);
            setMedia(result.media);

            if (result.importedItems.length > 0) {
                setMessage(
                    `${result.importedItems.length} vídeo(s) importado(s) por arrastar e soltar.`
                );
            } else if (result.duplicatedItems.length > 0) {
                setMessage(
                    "A mídia arrastada já estava cadastrada."
                );
            }

            return result;
        } finally {
            setIsLoading(false);
        }
    }

    async function handleRemoveMedia(
        mediaItem: MediaItem
    ) {
        const confirmed = window.confirm(
            `Remover "${mediaItem.name}" da biblioteca?\n\nO arquivo original não será apagado do computador.`
        );

        if (!confirmed) {
            return;
        }

        try {
            const result =
                await window.santtosAPI
                    .removeMedia(mediaItem.id);

            setMedia(result.media);

            if (
                selectedMedia?.sourceMediaId ===
                    mediaItem.id
            ) {
                setSelectedMedia(null);
            }

            if (result.removed) {
                setMessage(
                    `"${mediaItem.name}" foi removido.`
                );
            }
        } catch (error) {
            console.error(error);
            setMessage(
                "Não foi possível remover o vídeo."
            );
        }
    }

    async function saveHashtagStyle(
        style: HashtagStyle
    ) {
        const result =
            await window.santtosAPI
                .saveHashtagStyle(style);

        if (!result.ok) {
            throw new Error(
                "Não foi possível salvar o GC."
            );
        }

        setHashtagStyle(result.hashtagStyle);
    }

    const programmedDurationLabel =
        programmedIndefinite
            ? "LOOP"
            : formatProgrammedDuration(
                  programmedRemainingSeconds
              );
    const programmedUntilLabel =
        programmedIndefinite
            ? "SEM PREVISÃO"
            : programmedRemainingSeconds > 0
              ? new Date(
                    Date.now() +
                        programmedRemainingSeconds * 1000
                ).toLocaleTimeString(
                    "pt-BR",
                    {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit"
                    }
                )
              : "--:--:--";

    return (
        <div className="app-shell">
            <header className="topbar">
                <div className="brand">
                    <strong>Santtos TV</strong>
                    <span>Automation</span>
                </div>

                <div className="header-time-center">
                    <div className="master-clock">
                        {clock}
                    </div>
                    <div className="programmed-time-summary">
                        <div>
                            <span>PROGRAMADO</span>
                            <strong>{programmedDurationLabel}</strong>
                        </div>
                        <div>
                            <span>ATÉ</span>
                            <strong>{programmedUntilLabel}</strong>
                        </div>
                    </div>
                </div>

                <div className="system-status">
                    <span className="status-online">
                        ● SISTEMA ONLINE
                    </span>
                    <span
                        className={
                            ndiOnline
                                ? "status-online"
                                : ""
                        }
                    >
                        {ndiOnline
                            ? "● NDI ONLINE"
                            : "NDI OFFLINE"}
                    </span>
                </div>
            </header>

            <div className="workspace">
                <Sidebar
                    activePanel={activePanel}
                    setActivePanel={setActivePanel}
                />

                <main className="main-content">
                    <div
                        className={
                            activePanel === "playout"
                                ? "persistent-playout-view active"
                                : "persistent-playout-view hidden"
                        }
                        aria-hidden={activePanel !== "playout"}
                    >
                        <PlayoutPanel
                            media={media}
                            isLoading={isLoading}
                            message={message}
                            selectedMedia={selectedMedia}
                            hashtagStyle={hashtagStyle}
                            onSelectMedia={setSelectedMedia}
                            onAddVideos={addVideos}
                            onImportDroppedFiles={importDroppedFiles}
                            onRemoveMedia={handleRemoveMedia}
                            rundownApplyRequest={rundownApplyRequest}
                            onScheduleSummary={(remainingSeconds, indefinite) => {
                                setProgrammedRemainingSeconds(remainingSeconds);
                                setProgrammedIndefinite(indefinite);
                            }}
                        />
                    </div>

                    {activePanel === "scheduler" && (
                        <OpecSchedulerPanel
                            media={media}
                            onApply={(items) => {
                                setRundownApplyRequest({
                                    key: Date.now(),
                                    items: items as MediaItem[]
                                });
                                setActivePanel("playout");
                            }}
                        />
                    )}

                    {activePanel === "settings" && (
                        <BroadcastSettingsPanel
                            hashtagStyle={hashtagStyle}
                            onSaveHashtag={saveHashtagStyle}
                        />
                    )}

                    {activePanel !== "playout" &&
                        activePanel !== "settings" &&
                        activePanel !== "scheduler" && (
                        <EmptyPanel
                            title={activePanel}
                            message="Módulo em desenvolvimento."
                        />
                    )}
                </main>
            </div>

            <footer className="footer">
                <span>Santtos TV Automation</span>
                <span>
                    {media.length} mídia(s) cadastrada(s)
                </span>
                <span>Playout v0.3 Alpha</span>
            </footer>
        </div>
    );
}

interface SidebarProps {
    activePanel: Panel;
    setActivePanel: (
        panel: Panel
    ) => void;
}

function Sidebar({
    activePanel,
    setActivePanel
}: SidebarProps) {
    const buttons: Array<{
        panel: Panel;
        icon: string;
        label: string;
    }> = [
        { panel: "playout", icon: "📺", label: "Playout" },
        { panel: "playlist", icon: "📋", label: "Playlist" },
        { panel: "scheduler", icon: "🗓", label: "Scheduler" },
        { panel: "settings", icon: "⚙", label: "Configurações" }
    ];

    return (
        <aside className="sidebar">
            {buttons.map((button) => (
                <button
                    key={button.panel}
                    className={
                        activePanel === button.panel
                            ? "active"
                            : ""
                    }
                    onClick={() =>
                        setActivePanel(button.panel)
                    }
                >
                    {button.icon}{" "}
                    {button.label}
                </button>
            ))}
        </aside>
    );
}

interface PlayoutPanelProps {
    media: MediaItem[];
    isLoading: boolean;
    message: string;
    selectedMedia: MediaItem | null;
    hashtagStyle: HashtagStyle;
    onSelectMedia: (
        media: MediaItem
    ) => void;
    onAddVideos: () => Promise<void>;
    onImportDroppedFiles: (
        filePaths: string[]
    ) => Promise<ImportResult>;
    onRemoveMedia: (
        media: MediaItem
    ) => Promise<void>;
    rundownApplyRequest: {
        key: number;
        items: MediaItem[];
    } | null;
    onScheduleSummary: (
        remainingSeconds: number,
        indefinite: boolean
    ) => void;
}

function PlayoutPanel({
    media,
    isLoading,
    message,
    selectedMedia,
    hashtagStyle,
    onSelectMedia,
    onAddVideos,
    onImportDroppedFiles,
    onRemoveMedia,
    rundownApplyRequest,
    onScheduleSummary
}: PlayoutPanelProps) {
    const videoRef =
        useRef<HTMLVideoElement | null>(null);
    const timelineLoadedRef = useRef(false);
    const previousStyleRef = useRef(
        JSON.stringify(hashtagStyle)
    );

    const [currentTime, setCurrentTime] =
        useState(0);
    const [duration, setDuration] =
        useState(0);
    const [isPlaying, setIsPlaying] =
        useState(false);
    const [timelineQueue, setTimelineQueue] =
        useState<MediaItem[]>([]);
    const [draggedMediaId, setDraggedMediaId] =
        useState<string | null>(null);
    const [watermarkStyle, setWatermarkStyle] =
        useState<WatermarkStyle>(
            DEFAULT_WATERMARK_STYLE
        );
    const [watermarkPreviewUrl, setWatermarkPreviewUrl] =
        useState("");
    const [editingFilm, setEditingFilm] =
        useState<MediaItem | null>(null);
    const clipAdvanceGuardRef = useRef(false);
    const activeReportIdRef = useRef<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function loadWatermarkForProgram() {
            try {
                const settings =
                    await window.santtosAPI.getSettings();
                const style =
                    settings.watermarkStyle ??
                    DEFAULT_WATERMARK_STYLE;

                if (cancelled) {
                    return;
                }

                setWatermarkStyle(style);
                setWatermarkPreviewUrl("");

                if (!style.filePath) {
                    return;
                }

                const result =
                    await window.santtosAPI
                        .getWatermarkPreview(
                            style.filePath
                        );

                if (
                    !cancelled &&
                    result?.ok &&
                    result.dataUrl
                ) {
                    setWatermarkPreviewUrl(
                        result.dataUrl
                    );
                }
            } catch (error) {
                console.error(
                    "Erro ao carregar marca d'água do PROGRAM:",
                    error
                );
            }
        }

        loadWatermarkForProgram();

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        window.santtosAPI
            .getTimeline()
            .then((savedTimeline) => {
                if (!cancelled) {
                    setTimelineQueue(savedTimeline);
                    timelineLoadedRef.current = true;
                }
            })
            .catch((error) => {
                console.error(
                    "Erro ao carregar timeline:",
                    error
                );
                timelineLoadedRef.current = true;
            });

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!rundownApplyRequest) {
            return;
        }

        const prepared = rundownApplyRequest.items.map((item, index) => {
            const sourceMediaId = item.sourceMediaId ?? item.id;
            return {
                ...item,
                id: `${sourceMediaId}-rundown-${rundownApplyRequest.key}-${index}`,
                sourceMediaId,
                loop: false,
                watermark: Boolean(item.watermark),
                hashtag: item.hashtag ?? "",
                inPoint: getClipIn(item),
                outPoint: getClipOut(item)
            };
        });

        if (prepared.length === 0) {
            return;
        }

        if (isPlaying && selectedMedia) {
            setTimelineQueue((current) => {
                const currentIndex = current.findIndex(
                    (item) => item.id === selectedMedia.id
                );
                const preserved = currentIndex >= 0
                    ? current.slice(0, currentIndex + 1)
                    : [selectedMedia];
                return [...preserved, ...prepared];
            });
        } else {
            setTimelineQueue(prepared);
            onSelectMedia(prepared[0]);
            setCurrentTime(getClipIn(prepared[0]));
        }
    }, [rundownApplyRequest]);

    useEffect(() => {
        if (!timelineLoadedRef.current) {
            return;
        }

        const timer = window.setTimeout(
            () => {
                window.santtosAPI
                    .saveTimeline(timelineQueue)
                    .catch((error) =>
                        console.error(
                            "Erro ao salvar timeline:",
                            error
                        )
                    );
            },
            120
        );

        return () =>
            window.clearTimeout(timer);
    }, [timelineQueue]);

    useEffect(() => {
        if (!timelineLoadedRef.current) {
            return;
        }

        const mediaById = new Map(
            media.map((item) => [item.id, item])
        );

        setTimelineQueue((current) =>
            current
                .map((entry) => {
                    const sourceId =
                        entry.sourceMediaId ??
                        entry.id;
                    const source =
                        mediaById.get(sourceId);

                    if (!source) {
                        return null;
                    }

                    return {
                        ...source,
                        id: entry.id,
                        sourceMediaId: sourceId,
                        loop: Boolean(entry.loop),
                        watermark: Boolean(entry.watermark),
                        hashtag: entry.hashtag ?? "",
                        inPoint: normalizeClipPoint(entry.inPoint, 0),
                        outPoint: normalizeClipOutPoint(
                            entry.outPoint,
                            source.duration
                        ),
                        blockLabel: entry.blockLabel ?? ""
                    };
                })
                .filter(
                    (item): item is MediaItem =>
                        item !== null
                )
        );
    }, [media]);

    useEffect(() => {
        if (
            !selectedMedia &&
            timelineQueue.length > 0
        ) {
            onSelectMedia(timelineQueue[0]);
        }
    }, [
        timelineQueue,
        selectedMedia,
        onSelectMedia
    ]);

    const selectedMediaIndex =
        selectedMedia
            ? timelineQueue.findIndex(
                  (item) =>
                      item.id === selectedMedia.id
              )
            : -1;

    const timelineMedia =
        selectedMediaIndex >= 0
            ? timelineQueue.slice(
                  selectedMediaIndex
              )
            : timelineQueue;

    const nextMedia =
        selectedMediaIndex >= 0
            ? timelineQueue[
                  selectedMediaIndex + 1
              ] ?? null
            : null;

    const previousMedia =
        selectedMediaIndex > 0
            ? timelineQueue[
                  selectedMediaIndex - 1
              ] ?? null
            : null;

    const selectedClipIn = getClipIn(selectedMedia);
    const selectedClipOut = getClipOut(selectedMedia);
    const selectedClipDuration = getClipDuration(selectedMedia);
    const selectedClipCurrent = Math.max(
        0,
        currentTime - selectedClipIn
    );

    useEffect(() => {
        if (timelineQueue.length === 0) {
            onScheduleSummary(0, false);
            return;
        }

        const startIndex =
            selectedMediaIndex >= 0
                ? selectedMediaIndex
                : 0;
        const remainingItems =
            timelineQueue.slice(startIndex);
        const indefinite =
            remainingItems.some((item) => Boolean(item.loop));

        if (indefinite) {
            onScheduleSummary(0, true);
            return;
        }

        let remaining = 0;
        remainingItems.forEach((item, index) => {
            if (
                index === 0 &&
                selectedMediaIndex >= 0
            ) {
                remaining += Math.max(
                    0,
                    getClipDuration(item) -
                        selectedClipCurrent
                );
                return;
            }

            remaining += getClipDuration(item);
        });

        onScheduleSummary(remaining, false);
    }, [
        timelineQueue,
        selectedMediaIndex,
        selectedClipCurrent,
        onScheduleSummary
    ]);

    const watermarkFadeSeconds = Math.max(
        0,
        watermarkStyle.fadeMs / 1000
    );
    const watermarkPreviewOpacity =
        getOverlayPreviewOpacity({
            active: Boolean(
                selectedMedia?.watermark
            ),
            previousActive: Boolean(
                previousMedia?.watermark
            ),
            nextActive: Boolean(
                nextMedia?.watermark
            ),
            currentTime: selectedClipCurrent,
            duration: selectedClipDuration,
            fadeSeconds:
                watermarkFadeSeconds
        });
    const hashtagPreviewOpacity =
        getOverlayPreviewOpacity({
            active: Boolean(
                selectedMedia?.hashtag
            ),
            previousActive: Boolean(
                previousMedia?.hashtag
            ),
            nextActive: Boolean(
                nextMedia?.hashtag
            ),
            currentTime: selectedClipCurrent,
            duration: selectedClipDuration,
            fadeSeconds: 0.2
        });

    const selectedMediaUrl =
        selectedMedia
            ? encodeURI(
                  `file:///${selectedMedia.path.replace(
                      /\\/g,
                      "/"
                  )}`
              )
            : null;

    const progressPercent =
        selectedClipDuration > 0
            ? Math.min(
                  100,
                  Math.max(
                      0,
                      (selectedClipCurrent / selectedClipDuration) * 100
                  )
              )
            : 0;

    const timelineStartTimes = (() => {
        const startTimes =
            new Map<string, string>();
        let cursor = new Date(
            selectedMediaIndex >= 0
                ? Date.now() - currentTime * 1000
                : Date.now()
        );

        timelineMedia.forEach(
            (item, index) => {
                startTimes.set(
                    item.id,
                    cursor.toLocaleTimeString(
                        "pt-BR",
                        {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit"
                        }
                    )
                );

                const itemDuration =
                    index === 0 &&
                    selectedMediaIndex >= 0
                        ? Math.max(
                              0,
                              getClipDuration(item) -
                                  selectedClipCurrent
                          )
                        : getClipDuration(item);

                cursor = new Date(
                    cursor.getTime() +
                        itemDuration * 1000
                );
            }
        );

        return startTimes;
    })();

    useEffect(() => {
        const video = videoRef.current;

        if (!video || !selectedMediaUrl) {
            return;
        }

        video.pause();
        video.load();
        const inPoint = getClipIn(selectedMedia);
        try {
            video.currentTime = inPoint;
        } catch {
            // loadedmetadata will apply IN again.
        }
        setCurrentTime(inPoint);
        clipAdvanceGuardRef.current = false;
        setIsPlaying(false);
    }, [selectedMediaUrl]);

    function buildOverlayState(
        mediaItem: MediaItem,
        startSeconds = 0,
        continuousSelf = false
    ) {
        const itemIndex =
            timelineQueue.findIndex(
                (item) =>
                    item.id === mediaItem.id
            );
        const previous = continuousSelf
            ? mediaItem
            : itemIndex > 0
              ? timelineQueue[itemIndex - 1]
              : null;
        const following = mediaItem.loop
            ? mediaItem
            : itemIndex >= 0
              ? timelineQueue[
                    itemIndex + 1
                ] ?? null
              : null;
        const resuming =
            startSeconds > 0;

        return {
            durationSeconds:
                getClipOut(mediaItem),
            outPointSeconds:
                getClipOut(mediaItem),
            watermarkEnabled:
                Boolean(mediaItem.watermark),
            watermarkFadeIn:
                Boolean(mediaItem.watermark) &&
                !resuming &&
                !Boolean(previous?.watermark),
            watermarkFadeOut:
                Boolean(mediaItem.watermark) &&
                !Boolean(following?.watermark),
            hashtagFadeIn:
                Boolean(mediaItem.hashtag) &&
                !resuming &&
                !Boolean(previous?.hashtag),
            hashtagFadeOut:
                Boolean(mediaItem.hashtag) &&
                !Boolean(following?.hashtag),
            videoStreamIndex:
                mediaItem.videoStreamIndex ?? null,
            audioStreamIndex:
                mediaItem.audioStreamIndex ?? null,
            timingMode:
                mediaItem.timingMode ?? "unknown"
        };
    }

    async function startExecutionReport(mediaItem: MediaItem) {
        if (activeReportIdRef.current) {
            return;
        }

        try {
            const result = await window.santtosAPI.startPlayoutReport({
                ...mediaItem,
                inPoint: getClipIn(mediaItem),
                outPoint: getClipOut(mediaItem),
                plannedDurationSeconds: getClipDuration(mediaItem)
            });

            if (result.ok && result.id) {
                activeReportIdRef.current = result.id;
            } else if (!result.ok) {
                console.error(
                    "Não foi possível iniciar o relatório de exibição:",
                    result.error
                );
            }
        } catch (error) {
            console.error(
                "Erro no relatório de exibição:",
                error
            );
        }
    }

    async function finishExecutionReport(
        status: "EXECUTADO" | "PULADO",
        mediaItem: MediaItem | null = selectedMedia,
        forcedPlayedSeconds?: number
    ) {
        const reportId = activeReportIdRef.current;
        if (!reportId) {
            return;
        }

        activeReportIdRef.current = null;

        const videoTime = videoRef.current?.currentTime ?? currentTime;
        const playedSeconds = forcedPlayedSeconds ?? Math.max(
            0,
            videoTime - getClipIn(mediaItem)
        );

        try {
            const result = await window.santtosAPI.finishPlayoutReport(
                reportId,
                status,
                playedSeconds
            );
            if (!result.ok) {
                console.error(
                    "Não foi possível finalizar o relatório de exibição:",
                    result.error
                );
            }
        } catch (error) {
            console.error(
                "Erro ao finalizar relatório de exibição:",
                error
            );
        }
    }

    async function startNativeNdi(
        mediaItem: MediaItem,
        startSeconds = 0,
        continuousSelf = false
    ) {
        const result =
            await window.santtosAPI
                .playNdiFile(
                    mediaItem.path,
                    startSeconds,
                    mediaItem.hashtag ?? "",
                    buildOverlayState(
                        mediaItem,
                        startSeconds,
                        continuousSelf
                    )
                );

        if (!result.ok) {
            throw new Error(
                result.error ??
                    "Falha ao iniciar saída NDI."
            );
        }
    }

    useEffect(() => {
        const signature =
            JSON.stringify(hashtagStyle);

        if (
            signature === previousStyleRef.current
        ) {
            return;
        }

        previousStyleRef.current = signature;

        if (
            isPlaying &&
            selectedMedia?.hashtag
        ) {
            startNativeNdi(
                selectedMedia,
                videoRef.current?.currentTime ??
                    currentTime
            ).catch((error) =>
                console.error(
                    "Erro ao aplicar estilo do GC no NDI:",
                    error
                )
            );
        }
    }, [hashtagStyle]);

    async function playVideo() {
        let mediaToPlay = selectedMedia;

        if (!mediaToPlay) {
            mediaToPlay = timelineQueue[0] ?? null;

            if (!mediaToPlay) {
                window.alert(
                    "Não há vídeos na Timeline."
                );
                return;
            }

            onSelectMedia(mediaToPlay);
            await delay(120);
        }

        const video = videoRef.current;
        if (!video) {
            return;
        }

        try {
            const clipIn = getClipIn(mediaToPlay);
            const clipOut = getClipOut(mediaToPlay);
            if (
                !Number.isFinite(video.currentTime) ||
                video.currentTime < clipIn ||
                video.currentTime >= clipOut
            ) {
                video.currentTime = clipIn;
            }
            await startNativeNdi(
                mediaToPlay,
                video.currentTime || clipIn
            );
            await video.play();
            setIsPlaying(true);
            await startExecutionReport(mediaToPlay);
        } catch (error) {
            console.error(error);
            window.alert(
                `Não foi possível reproduzir o vídeo.\n\n${String(error)}`
            );
        }
    }

    async function pauseVideo() {
        videoRef.current?.pause();
        setIsPlaying(false);
        await window.santtosAPI.stopNdiFile();
    }

    async function stopVideo() {
        await finishExecutionReport("PULADO");
        await window.santtosAPI.stopNdiFile();
        const video = videoRef.current;

        if (video) {
            video.pause();
            const inPoint = getClipIn(selectedMedia);
            video.currentTime = inPoint;
        }

        setCurrentTime(getClipIn(selectedMedia));
        setIsPlaying(false);
    }

    async function playNextMedia(
        reason: "completed" | "skipped" = "skipped"
    ) {
        await finishExecutionReport(
            reason === "completed" ? "EXECUTADO" : "PULADO",
            selectedMedia,
            reason === "completed"
                ? getClipDuration(selectedMedia)
                : undefined
        );

        if (selectedMedia?.loop) {
            const video = videoRef.current;
            if (!video) {
                return;
            }

            const clipIn = getClipIn(selectedMedia);
            video.currentTime = clipIn;
            await startNativeNdi(
                selectedMedia,
                clipIn,
                true
            );
            await video.play();
            setIsPlaying(true);
            await startExecutionReport(selectedMedia);
            return;
        }

        if (!nextMedia) {
            setIsPlaying(false);
            await window.santtosAPI.stopNdiFile();
            return;
        }

        onSelectMedia(nextMedia);
        setCurrentTime(getClipIn(nextMedia));
        setDuration(getClipDuration(nextMedia));
        clipAdvanceGuardRef.current = false;
        await delay(120);

        const video = videoRef.current;
        if (!video) {
            return;
        }

        const nextIn = getClipIn(nextMedia);
        video.currentTime = nextIn;
        await startNativeNdi(nextMedia, nextIn);
        await video.play();
        setIsPlaying(true);
        await startExecutionReport(nextMedia);
    }

    async function handleProgramTimeUpdate(
        video: HTMLVideoElement
    ) {
        setCurrentTime(video.currentTime);

        if (!selectedMedia) {
            return;
        }

        const outPoint = getClipOut(selectedMedia);
        if (
            video.currentTime >= outPoint - 0.035 &&
            !clipAdvanceGuardRef.current
        ) {
            clipAdvanceGuardRef.current = true;
            await playNextMedia("completed");
        }
    }

    async function handleSeeked(
        video: HTMLVideoElement
    ) {
        if (selectedMedia) {
            const inPoint = getClipIn(selectedMedia);
            const outPoint = getClipOut(selectedMedia);
            if (video.currentTime < inPoint) {
                video.currentTime = inPoint;
                return;
            }
            if (video.currentTime >= outPoint) {
                video.currentTime = Math.max(
                    inPoint,
                    outPoint - 0.04
                );
                return;
            }
        }

        setCurrentTime(video.currentTime);

        if (!isPlaying || !selectedMedia) {
            return;
        }

        try {
            await startNativeNdi(
                selectedMedia,
                video.currentTime
            );
        } catch (error) {
            console.error(
                "Erro ao sincronizar seek NDI:",
                error
            );
        }
    }

    function addTimelineItem(
        mediaItem: MediaItem,
        targetMediaId?: string
    ) {
        const sourceMediaId =
            mediaItem.sourceMediaId ??
            mediaItem.id;

        const timelineItem: MediaItem = {
            ...mediaItem,
            id: `${sourceMediaId}-${Date.now()}-${Math.random()
                .toString(16)
                .slice(2)}`,
            sourceMediaId,
            loop: false,
            watermark: false,
            hashtag: "",
            inPoint: 0,
            outPoint: mediaItem.duration ?? null,
            blockLabel: ""
        };

        setTimelineQueue((current) => {
            if (!targetMediaId) {
                return [...current, timelineItem];
            }

            const targetIndex =
                current.findIndex(
                    (item) =>
                        item.id === targetMediaId
                );

            if (targetIndex < 0) {
                return [...current, timelineItem];
            }

            const updated = [...current];
            const insertIndex =
                targetMediaId === selectedMedia?.id
                    ? targetIndex + 1
                    : targetIndex;

            updated.splice(
                insertIndex,
                0,
                timelineItem
            );
            return updated;
        });
    }

    function removeTimelineItem(mediaId: string) {
        if (mediaId === selectedMedia?.id) {
            return;
        }

        setTimelineQueue((current) =>
            current.filter(
                (item) => item.id !== mediaId
            )
        );
    }

    function toggleTimelineLoop(mediaId: string) {
        setTimelineQueue((current) =>
            current.map((item) =>
                item.id === mediaId
                    ? {
                          ...item,
                          loop: !item.loop
                      }
                    : item
            )
        );

        if (selectedMedia?.id === mediaId) {
            onSelectMedia({
                ...selectedMedia,
                loop: !selectedMedia.loop
            });
        }
    }

    function toggleTimelineWatermark(
        mediaId: string
    ) {
        setTimelineQueue((current) =>
            current.map((item) =>
                item.id === mediaId
                    ? {
                          ...item,
                          watermark:
                              !item.watermark
                      }
                    : item
            )
        );

        if (
            selectedMedia?.id === mediaId
        ) {
            const updatedSelected = {
                ...selectedMedia,
                watermark:
                    !selectedMedia.watermark
            };

            onSelectMedia(updatedSelected);

            if (isPlaying) {
                startNativeNdi(
                    updatedSelected,
                    videoRef.current
                        ?.currentTime ??
                        currentTime,
                    true
                ).catch((error) =>
                    console.error(
                        "Erro ao atualizar marca d'água no NDI:",
                        error
                    )
                );
            }
        }
    }

    async function updateTimelineHashtag(
        mediaId: string,
        value: string
    ) {
        const hashtag = normalizeHashtag(value);

        setTimelineQueue((current) =>
            current.map((item) =>
                item.id === mediaId
                    ? { ...item, hashtag }
                    : item
            )
        );

        if (selectedMedia?.id === mediaId) {
            const updatedSelected = {
                ...selectedMedia,
                hashtag
            };

            onSelectMedia(updatedSelected);

            if (isPlaying) {
                try {
                    await startNativeNdi(
                        updatedSelected,
                        videoRef.current?.currentTime ??
                            currentTime
                    );
                } catch (error) {
                    console.error(
                        "Erro ao atualizar hashtag no NDI:",
                        error
                    );
                }
            }
        }
    }

    function applyFilmEdit(
        mediaId: string,
        inPoint: number,
        outPoint: number
    ) {
        const safeIn = Math.max(0, inPoint);
        const source = timelineQueue.find(
            (item) => item.id === mediaId
        );
        if (!source) return;
        const safeOut = Math.min(
            source.duration ?? outPoint,
            Math.max(safeIn + 0.1, outPoint)
        );

        setTimelineQueue((current) =>
            current.map((item) =>
                item.id === mediaId
                    ? {
                          ...item,
                          inPoint: safeIn,
                          outPoint: safeOut
                      }
                    : item
            )
        );

        if (selectedMedia?.id === mediaId) {
            const updated = {
                ...selectedMedia,
                inPoint: safeIn,
                outPoint: safeOut
            };
            onSelectMedia(updated);
            const video = videoRef.current;
            if (video) {
                video.currentTime = safeIn;
            }
            setCurrentTime(safeIn);
        }

        setEditingFilm(null);
    }

    function splitFilmIntoBlocks(
        mediaId: string,
        inPoint: number,
        cut1: number,
        cut2: number,
        outPoint: number
    ) {
        const sourceIndex = timelineQueue.findIndex(
            (item) => item.id === mediaId
        );
        const source = timelineQueue[sourceIndex];
        if (!source || sourceIndex < 0) return;

        const points = [inPoint, cut1, cut2, outPoint];
        if (
            points.some((value) => !Number.isFinite(value)) ||
            !(points[0] >= 0 &&
              points[0] < points[1] &&
              points[1] < points[2] &&
              points[2] < points[3])
        ) {
            window.alert(
                "Os cortes precisam estar em ordem: IN < Corte 1 < Corte 2 < OUT."
            );
            return;
        }

        const sourceDuration = source.duration ?? outPoint;
        if (outPoint > sourceDuration + 0.01) {
            window.alert(
                "O ponto OUT não pode ultrapassar a duração do arquivo."
            );
            return;
        }

        const sourceMediaId =
            source.sourceMediaId ?? source.id;
        const stamp = Date.now();
        const blocks = [0, 1, 2].map((index) => ({
            ...source,
            id: `${sourceMediaId}-block-${stamp}-${index + 1}`,
            sourceMediaId,
            inPoint: points[index],
            outPoint: points[index + 1],
            blockLabel: `Bloco ${index + 1}`,
            loop: false
        }));

        setTimelineQueue((current) => {
            const index = current.findIndex(
                (item) => item.id === mediaId
            );
            if (index < 0) return current;
            const updated = [...current];
            updated.splice(index, 1, ...blocks);
            return updated;
        });

        if (selectedMedia?.id === mediaId) {
            onSelectMedia(blocks[0]);
            setCurrentTime(blocks[0].inPoint ?? 0);
        }

        setEditingFilm(null);
    }

    function cutQueueTo(mediaId: string) {
        setTimelineQueue((current) => {
            const targetIndex =
                current.findIndex(
                    (item) => item.id === mediaId
                );
            const currentIndex =
                selectedMedia
                    ? current.findIndex(
                          (item) =>
                              item.id === selectedMedia.id
                      )
                    : -1;

            if (
                targetIndex < 0 ||
                (currentIndex >= 0 &&
                    targetIndex <= currentIndex)
            ) {
                return current;
            }

            return currentIndex >= 0
                ? [
                      ...current.slice(
                          0,
                          currentIndex + 1
                      ),
                      ...current.slice(targetIndex)
                  ]
                : current.slice(targetIndex);
        });
    }

    function moveToNext(mediaId: string) {
        setTimelineQueue((current) => {
            const sourceIndex =
                current.findIndex(
                    (item) => item.id === mediaId
                );
            const currentIndex =
                selectedMedia
                    ? current.findIndex(
                          (item) =>
                              item.id === selectedMedia.id
                      )
                    : -1;

            if (sourceIndex < 0) {
                return current;
            }

            const desiredIndex =
                currentIndex >= 0
                    ? currentIndex + 1
                    : 0;

            const updated = [...current];
            const [moved] = updated.splice(
                sourceIndex,
                1
            );
            const insertIndex =
                sourceIndex < desiredIndex
                    ? desiredIndex - 1
                    : desiredIndex;

            updated.splice(
                insertIndex,
                0,
                moved
            );
            return updated;
        });
    }

    async function importExplorerFilesToTimeline(
        files: FileList,
        targetMediaId?: string
    ) {
        const paths = Array.from(files)
            .map((file) =>
                window.santtosAPI.getDroppedFilePath(file)
            )
            .filter((value): value is string => Boolean(value));

        if (paths.length === 0) {
            return;
        }

        try {
            const result = await onImportDroppedFiles(paths);
            const normalized = (value: string) =>
                value.replace(/\\/g, "/").toLowerCase();
            const wanted = new Set(paths.map(normalized));
            const items = result.media.filter((item) =>
                wanted.has(normalized(item.path))
            );

            items.forEach((item, index) => {
                addTimelineItem(
                    item,
                    index === 0 ? targetMediaId : undefined
                );
            });
        } catch (error) {
            console.error(
                "Erro ao importar arquivos do Explorer para a timeline:",
                error
            );
        }
    }

    function moveTimelineItem(targetMediaId: string) {
        if (
            !draggedMediaId ||
            draggedMediaId === targetMediaId
        ) {
            setDraggedMediaId(null);
            return;
        }

        setTimelineQueue((current) => {
            const sourceIndex =
                current.findIndex(
                    (item) =>
                        item.id === draggedMediaId
                );
            const targetIndex =
                current.findIndex(
                    (item) =>
                        item.id === targetMediaId
                );

            const firstMovableIndex =
                selectedMediaIndex >= 0
                    ? selectedMediaIndex + 1
                    : 0;

            if (
                sourceIndex < firstMovableIndex ||
                targetIndex < firstMovableIndex
            ) {
                return current;
            }

            const updated = [...current];
            const [moved] = updated.splice(
                sourceIndex,
                1
            );
            updated.splice(
                targetIndex,
                0,
                moved
            );
            return updated;
        });

        setDraggedMediaId(null);
    }

    return (
        <div className="playout-operation-layout">
            <div className="program-column">
                <section className="panel program-card">
                    <div className="program-header">
                        <div>
                            <div className="panel-title">
                                PROGRAM
                            </div>
                            <strong>Saída principal</strong>
                        </div>

                        <span className="program-status">
                            {isPlaying
                                ? "● ON AIR"
                                : "● OFF AIR"}
                        </span>
                    </div>

                    <div className="program-monitor">
                        {selectedMediaUrl ? (
                            <>
                                <video
                                    id="program-video"
                                    ref={videoRef}
                                    className="program-video"
                                    src={selectedMediaUrl}
                                    controls
                                    preload="auto"
                                    onTimeUpdate={(event) =>
                                        handleProgramTimeUpdate(
                                            event.currentTarget
                                        )
                                    }
                                    onLoadedMetadata={(event) => {
                                        const video =
                                            event.currentTarget;
                                        const inPoint =
                                            getClipIn(selectedMedia);
                                        video.currentTime = inPoint;
                                        setCurrentTime(inPoint);
                                        setDuration(
                                            getClipDuration(selectedMedia)
                                        );
                                    }}
                                    onDurationChange={() =>
                                        setDuration(
                                            getClipDuration(selectedMedia)
                                        )
                                    }
                                    onSeeked={(event) =>
                                        handleSeeked(
                                            event.currentTarget
                                        )
                                    }
                                    onEnded={() => playNextMedia("completed")}
                                />

                                {watermarkPreviewUrl && (
                                    <img
                                        className="program-watermark"
                                        src={watermarkPreviewUrl}
                                        alt="Marca d'água do PROGRAM"
                                        style={{
                                            left: `${(watermarkStyle.x / 1920) * 100}%`,
                                            top: `${(watermarkStyle.y / 1080) * 100}%`,
                                            width: `${(watermarkStyle.widthPx / 1920) * 100}%`,
                                            opacity:
                                                watermarkPreviewOpacity *
                                                watermarkStyle.opacity
                                        }}
                                    />
                                )}

                                {selectedMedia?.hashtag && (
                                    <div
                                        className="program-hashtag"
                                        style={{
                                            ...getHashtagPreviewStyle(
                                                hashtagStyle
                                            ),
                                            opacity:
                                                hashtagPreviewOpacity
                                        }}
                                    >
                                        {selectedMedia.hashtag}
                                    </div>
                                )}
                            </>
                        ) : (
                            "SEM SINAL"
                        )}
                    </div>

                    <div className="program-controls">
                        <button
                            title="Reproduzir"
                            onClick={playVideo}
                        >▶</button>
                        <button
                            title="Pausar"
                            onClick={pauseVideo}
                        >⏸</button>
                        <button
                            title="Parar"
                            onClick={stopVideo}
                        >■</button>
                        <button
                            title="Próximo vídeo"
                            onClick={() => playNextMedia("skipped")}
                            disabled={!nextMedia}
                        >⏭</button>

                        <div className="program-time">
                            {formatDuration(selectedClipCurrent)}
                            {" / "}
                            {formatDuration(selectedClipDuration)}
                        </div>
                    </div>

                    <div className="program-progress">
                        <div
                            style={{
                                width: `${progressPercent}%`
                            }}
                        />
                    </div>
                </section>

                <div className="playout-status-row">
                    <section className="panel compact-status-card">
                        <div className="panel-title">
                            NO AR
                        </div>
                        <strong>
                            {selectedMedia
                                ? selectedMedia.name
                                : "Nenhum conteúdo"}
                        </strong>
                        <span>
                            {selectedMedia?.hashtag
                                ? `GC: ${selectedMedia.hashtag}`
                                : "Sem hashtag nesta entrada"}
                        </span>
                    </section>

                    <section className="panel compact-status-card">
                        <div className="panel-title">
                            PRÓXIMO
                        </div>
                        <strong>
                            {nextMedia
                                ? nextMedia.name
                                : "Nenhum conteúdo"}
                        </strong>
                        <span>
                            {nextMedia?.hashtag
                                ? `GC: ${nextMedia.hashtag}`
                                : nextMedia
                                  ? "Sem hashtag nesta entrada"
                                  : "Fim da timeline"}
                        </span>
                    </section>
                </div>

                <section
                    className="panel compact-logs-panel"
                    onDragOver={(event) => {
                        const hasFiles =
                            event.dataTransfer.types.includes("Files");
                        const hasLibraryMedia =
                            event.dataTransfer.types.includes(
                                "application/x-santtos-library-media"
                            );

                        if (hasFiles || hasLibraryMedia) {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "copy";
                        }
                    }}
                    onDrop={(event) => {
                        if (event.dataTransfer.files.length > 0) {
                            event.preventDefault();
                            event.stopPropagation();
                            void importExplorerFilesToTimeline(
                                event.dataTransfer.files
                            );
                            return;
                        }

                        const mediaId =
                            event.dataTransfer.getData(
                                "application/x-santtos-library-media"
                            );

                        if (!mediaId) {
                            return;
                        }

                        event.preventDefault();
                        const item = media.find(
                            (entry) => entry.id === mediaId
                        );

                        if (item) {
                            addTimelineItem(item);
                        }
                    }}
                >
                    <div className="panel-title">
                        TIMELINE
                    </div>

                    {timelineMedia.length > 0 ? (
                        <div className="timeline-list">
                            {timelineMedia.map(
                                (item, index) => {
                                    const isCurrent =
                                        item.id ===
                                        selectedMedia?.id;

                                    return (
                                        <div
                                            key={item.id}
                                            draggable={!isCurrent}
                                            className={`timeline-item ${
                                                isCurrent
                                                    ? "active"
                                                    : ""
                                            } ${
                                                draggedMediaId === item.id
                                                    ? "dragging"
                                                    : ""
                                            }`}
                                            onDoubleClick={() => {
                                                if (!isCurrent) {
                                                    cutQueueTo(item.id);
                                                }
                                            }}
                                            onDragStart={(event) => {
                                                if (isCurrent) {
                                                    event.preventDefault();
                                                    return;
                                                }

                                                setDraggedMediaId(item.id);
                                                event.dataTransfer.effectAllowed =
                                                    "move";
                                                event.dataTransfer.setData(
                                                    "text/plain",
                                                    item.id
                                                );
                                            }}
                                            onDragOver={(event) => {
                                                const isLibraryMedia =
                                                    event.dataTransfer.types.includes(
                                                        "application/x-santtos-library-media"
                                                    );
                                                const hasFiles =
                                                    event.dataTransfer.types.includes("Files");

                                                if (
                                                    hasFiles ||
                                                    isLibraryMedia ||
                                                    !isCurrent
                                                ) {
                                                    event.preventDefault();
                                                }
                                            }}
                                            onDrop={(event) => {
                                                event.preventDefault();
                                                event.stopPropagation();

                                                if (event.dataTransfer.files.length > 0) {
                                                    void importExplorerFilesToTimeline(
                                                        event.dataTransfer.files,
                                                        item.id
                                                    );
                                                    return;
                                                }

                                                const libraryId =
                                                    event.dataTransfer.getData(
                                                        "application/x-santtos-library-media"
                                                    );

                                                if (libraryId) {
                                                    const source = media.find(
                                                        (entry) =>
                                                            entry.id === libraryId
                                                    );
                                                    if (source) {
                                                        addTimelineItem(
                                                            source,
                                                            item.id
                                                        );
                                                    }
                                                    return;
                                                }

                                                if (!isCurrent) {
                                                    moveTimelineItem(item.id);
                                                }
                                            }}
                                            onDragEnd={() =>
                                                setDraggedMediaId(null)
                                            }
                                        >
                                            <div className="timeline-marker" />
                                            <div className="timeline-position">
                                                {isCurrent
                                                    ? "NO AR"
                                                    : `${index + 1}`}
                                            </div>

                                            <div className="timeline-content">
                                                <strong>
                                                    {item.blockLabel
                                                        ? `${item.name} — ${item.blockLabel}`
                                                        : item.name}
                                                </strong>
                                                <span>
                                                    {isCurrent
                                                        ? `${formatDuration(
                                                              selectedClipCurrent
                                                          )} / ${formatDuration(
                                                              selectedClipDuration
                                                          )}`
                                                        : formatDuration(
                                                              getClipDuration(item)
                                                          )}
                                                    {item.inPoint || item.outPoint != null
                                                        ? ` • IN ${formatDuration(
                                                              getClipIn(item)
                                                          )} • OUT ${formatDuration(
                                                              getClipOut(item)
                                                          )}`
                                                        : ""}
                                                </span>

                                                <span className="timeline-air-time">
                                                    {isCurrent
                                                        ? "ENTROU "
                                                        : "ENTRA "}
                                                    {timelineStartTimes.get(
                                                        item.id
                                                    ) ?? "--:--:--"}
                                                </span>
                                            </div>

                                            <div
                                                className="timeline-right-controls"
                                                onClick={(event) =>
                                                    event.stopPropagation()
                                                }
                                                onDoubleClick={(event) =>
                                                    event.stopPropagation()
                                                }
                                            >
                                                <div className="timeline-gc-controls">
                                                    <label
                                                        className="timeline-watermark-toggle"
                                                        title="Marca d'água"
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={Boolean(
                                                                item.watermark
                                                            )}
                                                            onChange={() =>
                                                                toggleTimelineWatermark(
                                                                    item.id
                                                                )
                                                            }
                                                        />
                                                        <span>Logo</span>
                                                    </label>

                                                    <div className="timeline-hashtag-editor">
                                                        <span>#</span>
                                                        <input
                                                            key={`${item.id}-${item.hashtag ?? ""}`}
                                                            defaultValue={
                                                                item.hashtag ?? ""
                                                            }
                                                            placeholder="Hashtag"
                                                            maxLength={80}
                                                            onBlur={(event) =>
                                                                updateTimelineHashtag(
                                                                    item.id,
                                                                    event.currentTarget.value
                                                                )
                                                            }
                                                            onKeyDown={(event) => {
                                                                if (event.key === "Enter") {
                                                                    event.currentTarget.blur();
                                                                }
                                                            }}
                                                        />
                                                    </div>
                                                </div>

                                                <div className="timeline-actions">
                                                    <button
                                                        className="timeline-film-edit"
                                                        title="Editar / separar filme em blocos"
                                                        onClick={() =>
                                                            setEditingFilm(item)
                                                        }
                                                    >✂ Blocos</button>
                                                    {!isCurrent && (
                                                        <button
                                                            title="Colocar como próximo"
                                                            onClick={() =>
                                                                moveToNext(item.id)
                                                            }
                                                        >⏭</button>
                                                    )}
                                                    <button
                                                        className={
                                                            item.loop
                                                                ? "timeline-loop-button active"
                                                                : "timeline-loop-button"
                                                        }
                                                        title="Loop"
                                                        onClick={() =>
                                                            toggleTimelineLoop(
                                                                item.id
                                                            )
                                                        }
                                                    >↻</button>
                                                    {!isCurrent && (
                                                        <button
                                                            className="timeline-remove"
                                                            title="Remover da timeline"
                                                            onClick={() =>
                                                                removeTimelineItem(
                                                                    item.id
                                                                )
                                                            }
                                                        >×</button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }
                            )}
                        </div>
                    ) : (
                        <span>
                            Timeline vazia. Adicione mídias usando + Timeline ou arrastando da biblioteca.
                        </span>
                    )}
                </section>
            </div>

            {editingFilm && (
                <FilmBlockEditor
                    item={editingFilm}
                    onClose={() => setEditingFilm(null)}
                    onSaveEdit={applyFilmEdit}
                    onSplit={splitFilmIntoBlocks}
                />
            )}

            <div className="playout-library-column">
                <LibraryPanel
                    media={media}
                    isLoading={isLoading}
                    message={message}
                    onAddVideos={onAddVideos}
                    onImportDroppedFiles={onImportDroppedFiles}
                    onRemoveMedia={onRemoveMedia}
                    onAddToTimeline={addTimelineItem}
                />
            </div>
        </div>
    );
}

interface FilmBlockEditorProps {
    item: MediaItem;
    onClose: () => void;
    onSaveEdit: (
        mediaId: string,
        inPoint: number,
        outPoint: number
    ) => void;
    onSplit: (
        mediaId: string,
        inPoint: number,
        cut1: number,
        cut2: number,
        outPoint: number
    ) => void;
}

function FilmBlockEditor({
    item,
    onClose,
    onSaveEdit,
    onSplit
}: FilmBlockEditorProps) {
    const duration = Math.max(0, item.duration ?? 0);
    const initialIn = getClipIn(item);
    const initialOut = getClipOut(item);
    const span = Math.max(0.3, initialOut - initialIn);

    const [inText, setInText] = useState(
        formatEditorTime(initialIn)
    );
    const [outText, setOutText] = useState(
        formatEditorTime(initialOut)
    );
    const [cut1Text, setCut1Text] = useState(
        formatEditorTime(initialIn + span / 3)
    );
    const [cut2Text, setCut2Text] = useState(
        formatEditorTime(initialIn + (span * 2) / 3)
    );

    const parsedIn = parseEditorTime(inText);
    const parsedOut = parseEditorTime(outText);
    const parsedCut1 = parseEditorTime(cut1Text);
    const parsedCut2 = parseEditorTime(cut2Text);

    const validEdit =
        parsedIn !== null &&
        parsedOut !== null &&
        parsedIn >= 0 &&
        parsedOut > parsedIn &&
        parsedOut <= duration + 0.01;

    const validSplit =
        validEdit &&
        parsedCut1 !== null &&
        parsedCut2 !== null &&
        parsedIn! < parsedCut1 &&
        parsedCut1 < parsedCut2 &&
        parsedCut2 < parsedOut!;

    return (
        <div
            className="film-editor-backdrop"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    onClose();
                }
            }}
        >
            <section className="film-editor-window">
                <header className="film-editor-header">
                    <div>
                        <span>EDIÇÃO NÃO DESTRUTIVA</span>
                        <h2>Editar / separar filme em blocos</h2>
                        <strong>{item.name}</strong>
                    </div>
                    <button onClick={onClose}>×</button>
                </header>

                <div className="film-editor-summary">
                    <span>Duração original</span>
                    <strong>{formatDuration(duration)}</strong>
                    <small>
                        O arquivo original não será alterado. Os blocos apenas guardam pontos IN/OUT.
                    </small>
                </div>

                <div className="film-editor-grid">
                    <TimecodeField
                        label="INÍCIO / IN"
                        value={inText}
                        onChange={setInText}
                    />
                    <TimecodeField
                        label="CORTE 1"
                        value={cut1Text}
                        onChange={setCut1Text}
                    />
                    <TimecodeField
                        label="CORTE 2"
                        value={cut2Text}
                        onChange={setCut2Text}
                    />
                    <TimecodeField
                        label="FINAL / OUT"
                        value={outText}
                        onChange={setOutText}
                    />
                </div>

                <div className="film-editor-block-preview">
                    <div>
                        <strong>Bloco 1</strong>
                        <span>{formatRange(parsedIn, parsedCut1)}</span>
                    </div>
                    <div>
                        <strong>Bloco 2</strong>
                        <span>{formatRange(parsedCut1, parsedCut2)}</span>
                    </div>
                    <div>
                        <strong>Bloco 3</strong>
                        <span>{formatRange(parsedCut2, parsedOut)}</span>
                    </div>
                </div>

                {!validEdit && (
                    <div className="film-editor-error">
                        IN/OUT inválidos. Use mm:ss ou hh:mm:ss e não ultrapasse a duração do filme.
                    </div>
                )}

                <footer className="film-editor-footer">
                    <button onClick={onClose}>Cancelar</button>
                    <button
                        disabled={!validEdit}
                        onClick={() =>
                            validEdit &&
                            onSaveEdit(
                                item.id,
                                parsedIn!,
                                parsedOut!
                            )
                        }
                    >
                        Salvar somente edição
                    </button>
                    <button
                        className="primary-button"
                        disabled={!validSplit}
                        onClick={() =>
                            validSplit &&
                            onSplit(
                                item.id,
                                parsedIn!,
                                parsedCut1!,
                                parsedCut2!,
                                parsedOut!
                            )
                        }
                    >
                        Separar em 3 blocos
                    </button>
                </footer>
            </section>
        </div>
    );
}

function TimecodeField({
    label,
    value,
    onChange
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <label className="film-timecode-field">
            <span>{label}</span>
            <input
                value={value}
                inputMode="numeric"
                placeholder="00:00"
                onChange={(event) =>
                    onChange(event.currentTarget.value)
                }
            />
        </label>
    );
}

interface LibraryPanelProps {
    media: MediaItem[];
    isLoading: boolean;
    message: string;
    onAddVideos: () => Promise<void>;
    onImportDroppedFiles: (
        filePaths: string[]
    ) => Promise<ImportResult>;
    onRemoveMedia: (
        media: MediaItem
    ) => Promise<void>;
    onAddToTimeline: (
        media: MediaItem
    ) => void;
}

function LibraryPanel({
    media,
    isLoading,
    message,
    onAddVideos,
    onImportDroppedFiles,
    onRemoveMedia,
    onAddToTimeline
}: LibraryPanelProps) {
    const [search, setSearch] = useState("");
    const [categories, setCategories] = useState<LibraryCategory[]>([]);
    const [activeCategoryId, setActiveCategoryId] = useState("");
    const [categoryStatus, setCategoryStatus] = useState("");
    const [isRefreshing, setIsRefreshing] = useState(false);

    async function loadCategories(preferredId?: string) {
        try {
            const loaded = await window.santtosAPI.getLibraryCategories();
            setCategories(loaded);
            const nextId = preferredId && loaded.some((item) => item.id === preferredId)
                ? preferredId
                : loaded.some((item) => item.id === activeCategoryId)
                  ? activeCategoryId
                  : loaded[0]?.id ?? "";
            setActiveCategoryId(nextId);
        } catch (error) {
            console.error(error);
            setCategoryStatus("Não foi possível carregar as abas da Biblioteca.");
        }
    }

    useEffect(() => {
        void loadCategories();
    }, []);

    const activeCategory = categories.find((item) => item.id === activeCategoryId) ?? null;

    function belongsToFolder(filePath: string, folderPath: string) {
        if (!folderPath) return false;
        const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
        const file = normalize(filePath);
        const folder = normalize(folderPath);
        return file.startsWith(`${folder}/`) && !file.slice(folder.length + 1).includes("/");
    }

    const categoryMedia = useMemo(() => {
        if (!activeCategory?.folderPath) return [];
        return media.filter((item) => belongsToFolder(item.path, activeCategory.folderPath));
    }, [media, activeCategory?.folderPath]);

    const filteredMedia = useMemo(() => {
        const normalized = search.trim().toLowerCase();
        if (!normalized) return categoryMedia;
        return categoryMedia.filter((item) => item.name.toLowerCase().includes(normalized));
    }, [categoryMedia, search]);

    async function refreshCategory() {
        if (!activeCategory) return;
        setIsRefreshing(true);
        setCategoryStatus("");
        try {
            const result = await window.santtosAPI.scanLibraryCategory(activeCategory.id);
            if (!result.ok) throw new Error(result.error ?? "Falha ao atualizar");
            if (result.unconfigured) {
                setCategoryStatus("Configure a pasta desta aba em Configurações → Biblioteca.");
                return;
            }
            if (result.folderMissing) {
                setCategoryStatus("A pasta configurada não foi encontrada no Windows.");
                return;
            }
            const paths = result.filePaths ?? [];
            if (paths.length > 0) {
                await onImportDroppedFiles(paths);
            }
            setCategoryStatus(`${paths.length} arquivo(s) encontrado(s) em ${activeCategory.name}.`);
        } catch (error) {
            console.error(error);
            setCategoryStatus("Não foi possível atualizar esta pasta.");
        } finally {
            setIsRefreshing(false);
        }
    }

    async function createCategory() {
        const name = window.prompt("Nome da nova aba da Biblioteca:")?.trim();
        if (!name) return;

        setCategoryStatus("Selecione a pasta da nova aba...");

        try {
            const folderResult = await window.santtosAPI.selectLibraryFolder();

            if (!folderResult.ok || !folderResult.folderPath) {
                setCategoryStatus(
                    folderResult.canceled
                        ? "Criação cancelada: nenhuma pasta foi selecionada."
                        : "Não foi possível selecionar a pasta da nova aba."
                );
                return;
            }

            const created: LibraryCategory = {
                id: `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                name: name.slice(0, 40),
                folderPath: folderResult.folderPath,
                builtIn: false
            };

            const result = await window.santtosAPI.saveLibraryCategories([
                ...categories,
                created
            ]);

            if (!result.ok) {
                setCategoryStatus(
                    result.error ?? "Não foi possível criar a aba."
                );
                return;
            }

            const saved = result.categories ?? [...categories, created];
            setCategories(saved);
            setActiveCategoryId(created.id);
            setSearch("");
            setCategoryStatus(`Aba ${created.name} criada e vinculada à pasta selecionada.`);

            const scanResult = await window.santtosAPI.scanLibraryCategory(created.id);
            if (scanResult.ok && (scanResult.filePaths?.length ?? 0) > 0) {
                await onImportDroppedFiles(scanResult.filePaths ?? []);
                setCategoryStatus(
                    `Aba ${created.name} criada. ${scanResult.filePaths?.length ?? 0} arquivo(s) encontrado(s).`
                );
            }
        } catch (error) {
            console.error(error);
            setCategoryStatus("Não foi possível criar a nova aba da Biblioteca.");
        }
    }

    async function handleExplorerDrop(files: FileList) {
        const paths = Array.from(files)
            .map((file) => window.santtosAPI.getDroppedFilePath(file))
            .filter((value): value is string => Boolean(value));
        if (paths.length > 0) await onImportDroppedFiles(paths);
    }

    return (
        <section
            className="panel module-panel"
            onDragOver={(event) => {
                if (event.dataTransfer.types.includes("Files")) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "copy";
                }
            }}
            onDrop={(event) => {
                if (event.dataTransfer.files.length === 0) return;
                event.preventDefault();
                event.stopPropagation();
                void handleExplorerDrop(event.dataTransfer.files);
            }}
        >
            <div className="module-header">
                <div>
                    <div className="panel-title">BIBLIOTECA</div>
                    <h1>{activeCategory?.name ?? "Biblioteca de mídia"}</h1>
                </div>
                <button
                    className="library-refresh-button"
                    onClick={refreshCategory}
                    disabled={isRefreshing || !activeCategory}
                >
                    {isRefreshing ? "Atualizando..." : "↻ Atualizar"}
                </button>
            </div>

            <div className="library-category-tabs">
                {categories.map((category) => (
                    <button
                        key={category.id}
                        type="button"
                        className={category.id === activeCategoryId ? "active" : ""}
                        onClick={() => {
                            setActiveCategoryId(category.id);
                            setSearch("");
                            setCategoryStatus("");
                        }}
                    >
                        {category.name}
                    </button>
                ))}
                <button type="button" className="library-new-tab" onClick={createCategory}>
                    + Nova aba
                </button>
            </div>

            <div className="library-category-status">
                <strong>{activeCategory?.folderPath ? "Pasta:" : "Sem pasta configurada"}</strong>
                {activeCategory?.folderPath && <span title={activeCategory.folderPath}>{activeCategory.folderPath}</span>}
            </div>

            <div className="library-toolbar">
                <input
                    className="search-input"
                    type="search"
                    value={search}
                    placeholder={`Pesquisar em ${activeCategory?.name ?? "Biblioteca"}...`}
                    onChange={(event) => setSearch(event.target.value)}
                />
                <span>{filteredMedia.length} arquivo(s)</span>
            </div>

            {(categoryStatus || message) && (
                <div className="library-message">{categoryStatus || message}</div>
            )}

            {!activeCategory?.folderPath ? (
                <div className="empty-state">Configure a pasta desta aba em Configurações → Biblioteca</div>
            ) : filteredMedia.length === 0 ? (
                <div className="empty-state">Nenhum vídeo nesta pasta. Clique em Atualizar.</div>
            ) : (
                <div className="media-list">
                    {filteredMedia.map((item) => (
                        <article
                            key={item.id}
                            draggable
                            className="media-item"
                            onDoubleClick={(event) => {
                                event.stopPropagation();
                                onAddToTimeline(item);
                            }}
                            onDragStart={(event) => {
                                event.dataTransfer.effectAllowed = "copy";
                                event.dataTransfer.setData("application/x-santtos-library-media", item.id);
                            }}
                        >
                            <div className="media-thumbnail">{item.extension.toUpperCase()}</div>
                            <div className="media-information">
                                <strong>{item.name}</strong>
                                <span>{item.path}</span>
                                <div className="media-metadata">
                                    <span>{item.width && item.height ? `${item.width}×${item.height}` : "Resolução desconhecida"}</span>
                                    <span>{item.videoCodec ?? "Codec desconhecido"}</span>
                                    <span>{item.fps !== null ? `${item.fps.toFixed(3)} fps` : "FPS desconhecido"}</span>
                                    <span>{formatDuration(item.duration)}</span>
                                </div>
                            </div>
                            <button
                                className="remove-media-button"
                                title="Remover da biblioteca"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onRemoveMedia(item);
                                }}
                            >
                                Remover
                            </button>
                            <button
                                className="add-timeline-button"
                                title="Adicionar ao final da timeline"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onAddToTimeline(item);
                                }}
                            >
                                + Timeline
                            </button>
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}

function HashtagSettingsPanel({
    hashtagStyle,
    onSave
}: {
    hashtagStyle: HashtagStyle;
    onSave: (
        style: HashtagStyle
    ) => Promise<void>;
}) {
    const [draft, setDraft] =
        useState<HashtagStyle>(hashtagStyle);
    const [status, setStatus] =
        useState("");

    useEffect(() => {
        setDraft(hashtagStyle);
    }, [hashtagStyle]);

    function patch(
        values: Partial<HashtagStyle>
    ) {
        setDraft((current) => ({
            ...current,
            ...values
        }));
        setStatus("");
    }

    async function save() {
        try {
            await onSave(draft);
            setStatus(
                "Configuração salva e aplicada ao PROGRAM."
            );
        } catch (error) {
            console.error(error);
            setStatus(
                "Não foi possível salvar a configuração."
            );
        }
    }

    return (
        <section className="panel hashtag-settings-panel">
            <div className="settings-header">
                <div>
                    <div className="panel-title">
                        CONFIGURAÇÕES
                    </div>
                    <h1>Hashtag / GC do PROGRAM</h1>
                    <p>
                        Todos os valores são relativos ao output final 1920×1080, independentemente da proporção do arquivo.
                    </p>
                </div>

                <div className="settings-actions">
                    <button
                        type="button"
                        onClick={() =>
                            setDraft(
                                DEFAULT_HASHTAG_STYLE
                            )
                        }
                    >
                        Restaurar padrão
                    </button>
                    <button
                        type="button"
                        className="primary-button"
                        onClick={save}
                    >
                        Aplicar e salvar
                    </button>
                </div>
            </div>

            <div className="hashtag-settings-layout">
                <div className="hashtag-settings-controls">
                    <SettingsGroup title="Tipografia">
                        <label className="setting-field">
                            <span>Fonte</span>
                            <select
                                value={draft.fontFamily}
                                onChange={(event) =>
                                    patch({
                                        fontFamily:
                                            event.currentTarget.value
                                    })
                                }
                            >
                                <option>Arial</option>
                                <option>Segoe UI</option>
                                <option>Tahoma</option>
                                <option>Verdana</option>
                                <option>Calibri</option>
                            </select>
                        </label>

                        <NumberField
                            label="Tamanho no Full HD"
                            value={draft.fontSize}
                            min={10}
                            max={160}
                            suffix="px"
                            onChange={(value) =>
                                patch({ fontSize: value })
                            }
                        />

                        <label className="setting-toggle">
                            <input
                                type="checkbox"
                                checked={draft.bold}
                                onChange={(event) =>
                                    patch({
                                        bold:
                                            event.currentTarget.checked
                                    })
                                }
                            />
                            <span>Negrito</span>
                        </label>
                    </SettingsGroup>

                    <SettingsGroup title="Cor e opacidade">
                        <ColorField
                            label="Cor do texto"
                            value={draft.color}
                            onChange={(value) =>
                                patch({ color: value })
                            }
                        />

                        <RangeField
                            label="Opacidade"
                            value={draft.opacity}
                            min={0}
                            max={1}
                            step={0.01}
                            display={`${Math.round(
                                draft.opacity * 100
                            )}%`}
                            onChange={(value) =>
                                patch({ opacity: value })
                            }
                        />
                    </SettingsGroup>

                    <SettingsGroup title="Posição no output 1920×1080">
                        <NumberField
                            label="Posição X"
                            value={draft.x}
                            min={0}
                            max={1920}
                            suffix="px"
                            onChange={(value) =>
                                patch({ x: value })
                            }
                        />
                        <NumberField
                            label="Posição Y"
                            value={draft.y}
                            min={0}
                            max={1080}
                            suffix="px"
                            onChange={(value) =>
                                patch({ y: value })
                            }
                        />
                    </SettingsGroup>

                    <SettingsGroup title="Contorno">
                        <RangeField
                            label="Espessura"
                            value={draft.outlineWidth}
                            min={0}
                            max={12}
                            step={1}
                            display={`${draft.outlineWidth}px`}
                            onChange={(value) =>
                                patch({
                                    outlineWidth: value
                                })
                            }
                        />
                        <ColorField
                            label="Cor do contorno"
                            value={draft.outlineColor}
                            onChange={(value) =>
                                patch({
                                    outlineColor: value
                                })
                            }
                        />
                        <RangeField
                            label="Opacidade do contorno"
                            value={draft.outlineOpacity}
                            min={0}
                            max={1}
                            step={0.01}
                            display={`${Math.round(
                                draft.outlineOpacity * 100
                            )}%`}
                            onChange={(value) =>
                                patch({
                                    outlineOpacity: value
                                })
                            }
                        />
                    </SettingsGroup>

                    <SettingsGroup title="Sombra">
                        <label className="setting-toggle">
                            <input
                                type="checkbox"
                                checked={draft.shadowEnabled}
                                onChange={(event) =>
                                    patch({
                                        shadowEnabled:
                                            event.currentTarget.checked
                                    })
                                }
                            />
                            <span>Ativar sombra</span>
                        </label>

                        <ColorField
                            label="Cor da sombra"
                            value={draft.shadowColor}
                            disabled={!draft.shadowEnabled}
                            onChange={(value) =>
                                patch({
                                    shadowColor: value
                                })
                            }
                        />

                        <RangeField
                            label="Opacidade da sombra"
                            value={draft.shadowOpacity}
                            min={0}
                            max={1}
                            step={0.01}
                            disabled={!draft.shadowEnabled}
                            display={`${Math.round(
                                draft.shadowOpacity * 100
                            )}%`}
                            onChange={(value) =>
                                patch({
                                    shadowOpacity: value
                                })
                            }
                        />

                        <NumberField
                            label="Deslocamento X"
                            value={draft.shadowX}
                            min={-30}
                            max={30}
                            suffix="px"
                            disabled={!draft.shadowEnabled}
                            onChange={(value) =>
                                patch({ shadowX: value })
                            }
                        />

                        <NumberField
                            label="Deslocamento Y"
                            value={draft.shadowY}
                            min={-30}
                            max={30}
                            suffix="px"
                            disabled={!draft.shadowEnabled}
                            onChange={(value) =>
                                patch({ shadowY: value })
                            }
                        />
                    </SettingsGroup>
                </div>

                <div className="hashtag-settings-preview-column">
                    <div className="panel-title">
                        PREVIEW DO OUTPUT 1920×1080
                    </div>

                    <div className="hashtag-output-preview">
                        <div className="preview-safe-area" />
                        <div
                            className="program-hashtag settings-preview-hashtag"
                            style={
                                getHashtagPreviewStyle(
                                    draft
                                )
                            }
                        >
                            #RondaPopular
                        </div>
                    </div>

                    <div className="settings-summary">
                        <strong>Coordenadas reais</strong>
                        <span>
                            X {Math.round(draft.x)} px · Y {Math.round(draft.y)} px · {Math.round(draft.fontSize)} px
                        </span>
                        <span>
                            Este preview escala o mesmo canvas 1920×1080. Um vídeo 4:3 não altera o GC.
                        </span>
                    </div>

                    {status && (
                        <div className="library-message">
                            {status}
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
}

function SettingsGroup({
    title,
    children
}: {
    title: string;
    children: React.ReactNode;
}) {
    return (
        <div className="settings-group">
            <h2>{title}</h2>
            {children}
        </div>
    );
}

function NumberField({
    label,
    value,
    min,
    max,
    suffix,
    disabled = false,
    onChange
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    suffix: string;
    disabled?: boolean;
    onChange: (value: number) => void;
}) {
    return (
        <label className="setting-field">
            <span>{label}</span>
            <div className="number-input-with-suffix">
                <input
                    type="number"
                    value={value}
                    min={min}
                    max={max}
                    disabled={disabled}
                    onChange={(event) =>
                        onChange(
                            clamp(
                                Number(
                                    event.currentTarget.value
                                ),
                                min,
                                max
                            )
                        )
                    }
                />
                <small>{suffix}</small>
            </div>
        </label>
    );
}

function RangeField({
    label,
    value,
    min,
    max,
    step,
    display,
    disabled = false,
    onChange
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    display: string;
    disabled?: boolean;
    onChange: (value: number) => void;
}) {
    return (
        <label className="setting-field range-setting-field">
            <span>
                {label}
                <strong>{display}</strong>
            </span>
            <input
                type="range"
                value={value}
                min={min}
                max={max}
                step={step}
                disabled={disabled}
                onChange={(event) =>
                    onChange(
                        Number(
                            event.currentTarget.value
                        )
                    )
                }
            />
        </label>
    );
}

function ColorField({
    label,
    value,
    disabled = false,
    onChange
}: {
    label: string;
    value: string;
    disabled?: boolean;
    onChange: (value: string) => void;
}) {
    return (
        <label className="setting-field color-setting-field">
            <span>{label}</span>
            <div>
                <input
                    type="color"
                    value={value}
                    disabled={disabled}
                    onChange={(event) =>
                        onChange(
                            event.currentTarget.value
                        )
                    }
                />
                <code>{value.toUpperCase()}</code>
            </div>
        </label>
    );
}

function EmptyPanel({
    title,
    message
}: {
    title: string;
    message: string;
}) {
    return (
        <section className="panel module-panel">
            <div className="panel-title">
                {title.toUpperCase()}
            </div>
            <div className="empty-state">
                {message}
            </div>
        </section>
    );
}

function getOverlayPreviewOpacity({
    active,
    previousActive,
    nextActive,
    currentTime,
    duration,
    fadeSeconds
}: {
    active: boolean;
    previousActive: boolean;
    nextActive: boolean;
    currentTime: number;
    duration: number;
    fadeSeconds: number;
}) {
    if (!active) {
        return 0;
    }

    if (fadeSeconds <= 0) {
        return 1;
    }

    let alpha = 1;

    if (
        !previousActive &&
        currentTime < fadeSeconds
    ) {
        alpha = Math.min(
            alpha,
            currentTime / fadeSeconds
        );
    }

    const remaining =
        duration > 0
            ? duration - currentTime
            : Number.POSITIVE_INFINITY;

    if (
        !nextActive &&
        remaining < fadeSeconds
    ) {
        alpha = Math.min(
            alpha,
            remaining / fadeSeconds
        );
    }

    return Math.max(0, Math.min(1, alpha));
}

function getHashtagPreviewStyle(
    style: HashtagStyle
): CSSProperties {
    const shadowParts: string[] = [];

    if (style.shadowEnabled) {
        shadowParts.push(
            `${style.shadowX / 19.2}cqw ${style.shadowY / 19.2}cqw ${Math.max(
                1,
                Math.abs(style.shadowX) +
                    Math.abs(style.shadowY)
            ) / 19.2}cqw ${hexToRgba(
                style.shadowColor,
                style.shadowOpacity
            )}`
        );
    }

    return {
        left: `${(style.x / 1920) * 100}%`,
        top: `${(style.y / 1080) * 100}%`,
        fontFamily: style.fontFamily,
        fontSize: `${style.fontSize / 19.2}cqw`,
        fontWeight: style.bold ? 700 : 400,
        color: hexToRgba(
            style.color,
            style.opacity
        ),
        WebkitTextStroke:
            style.outlineWidth > 0
                ? `${style.outlineWidth / 19.2}cqw ${hexToRgba(
                      style.outlineColor,
                      style.outlineOpacity
                  )}`
                : "0 transparent",
        textShadow:
            shadowParts.length > 0
                ? shadowParts.join(", ")
                : "none"
    };
}

function hexToRgba(
    hex: string,
    opacity: number
) {
    const value = hex.replace("#", "");
    const red = parseInt(value.slice(0, 2), 16);
    const green = parseInt(value.slice(2, 4), 16);
    const blue = parseInt(value.slice(4, 6), 16);

    return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}

function formatProgrammedDuration(seconds: number) {
    const safe = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const secs = safe % 60;

    return [hours, minutes, secs]
        .map((value) => String(value).padStart(2, "0"))
        .join(":");
}

function normalizeClipPoint(
    value: unknown,
    fallback = 0
) {
    const parsed = Number(value);
    return Number.isFinite(parsed)
        ? Math.max(0, parsed)
        : fallback;
}

function normalizeClipOutPoint(
    value: unknown,
    sourceDuration: number | null | undefined
) {
    const duration = Math.max(
        0,
        Number(sourceDuration) || 0
    );
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return duration;
    }
    return duration > 0
        ? Math.min(duration, parsed)
        : parsed;
}

function getClipIn(item: MediaItem | null) {
    return normalizeClipPoint(item?.inPoint, 0);
}

function getClipOut(item: MediaItem | null) {
    const sourceDuration = Math.max(
        0,
        Number(item?.duration) || 0
    );
    return normalizeClipOutPoint(
        item?.outPoint,
        sourceDuration
    );
}

function getClipDuration(item: MediaItem | null) {
    return Math.max(
        0,
        getClipOut(item) - getClipIn(item)
    );
}

function parseEditorTime(value: string) {
    const clean = value.trim();
    if (!clean) return null;

    if (/^\d+(?:[.,]\d+)?$/.test(clean)) {
        const numeric = Number(clean.replace(",", "."));
        return Number.isFinite(numeric) ? numeric : null;
    }

    const parts = clean.split(":");
    if (parts.length < 2 || parts.length > 3) {
        return null;
    }

    const numbers = parts.map((part) =>
        Number(part.replace(",", "."))
    );
    if (numbers.some((part) => !Number.isFinite(part))) {
        return null;
    }

    if (parts.length === 2) {
        return numbers[0] * 60 + numbers[1];
    }

    return (
        numbers[0] * 3600 +
        numbers[1] * 60 +
        numbers[2]
    );
}

function formatEditorTime(seconds: number) {
    const safe = Math.max(0, seconds || 0);
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const secs = Math.floor(safe % 60);

    return hours > 0
        ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
        : `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatRange(
    start: number | null,
    end: number | null
) {
    if (start === null || end === null || end <= start) {
        return "--:--";
    }
    return `${formatEditorTime(start)} → ${formatEditorTime(end)} • ${formatDuration(end - start)}`;
}

function normalizeHashtag(value: string) {
    const normalized = value
        .trim()
        .replace(/\s+/g, "");

    if (!normalized) {
        return "";
    }

    return (
        normalized.startsWith("#")
            ? normalized
            : `#${normalized}`
    ).slice(0, 80);
}

function clamp(
    value: number,
    min: number,
    max: number
) {
    if (!Number.isFinite(value)) {
        return min;
    }

    return Math.min(max, Math.max(min, value));
}

function delay(milliseconds: number) {
    return new Promise<void>((resolve) =>
        window.setTimeout(resolve, milliseconds)
    );
}

function formatDuration(
    value: number | null
): string {
    if (
        value === null ||
        !Number.isFinite(value)
    ) {
        return "00:00:00";
    }

    const totalSeconds = Math.max(
        0,
        Math.floor(value)
    );
    const hours = Math.floor(
        totalSeconds / 3600
    );
    const minutes = Math.floor(
        (totalSeconds % 3600) / 60
    );
    const seconds = totalSeconds % 60;

    return [hours, minutes, seconds]
        .map((part) =>
            String(part).padStart(2, "0")
        )
        .join(":");
}
