import {
    useEffect,
    useMemo,
    useRef,
    useState
} from "react";
import type { CSSProperties } from "react";
import BroadcastSettingsPanel from "./BroadcastSettingsPanel";

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
            removeMedia: (
                mediaId: string
            ) => Promise<RemoveResult>;
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

    return (
        <div className="app-shell">
            <header className="topbar">
                <div className="brand">
                    <strong>Santtos TV</strong>
                    <span>Automation</span>
                </div>

                <div className="master-clock">
                    {clock}
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
                    {activePanel === "playout" && (
                        <PlayoutPanel
                            media={media}
                            isLoading={isLoading}
                            message={message}
                            selectedMedia={selectedMedia}
                            hashtagStyle={hashtagStyle}
                            onSelectMedia={setSelectedMedia}
                            onAddVideos={addVideos}
                            onRemoveMedia={handleRemoveMedia}
                        />
                    )}

                    {activePanel === "settings" && (
                        <BroadcastSettingsPanel
                            hashtagStyle={hashtagStyle}
                            onSaveHashtag={saveHashtagStyle}
                        />
                    )}

                    {activePanel !== "playout" &&
                        activePanel !== "settings" && (
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
        { panel: "library", icon: "📁", label: "Biblioteca" },
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
    onRemoveMedia: (
        media: MediaItem
    ) => Promise<void>;
}

function PlayoutPanel({
    media,
    isLoading,
    message,
    selectedMedia,
    hashtagStyle,
    onSelectMedia,
    onAddVideos,
    onRemoveMedia
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
                        hashtag: entry.hashtag ?? ""
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
            currentTime,
            duration,
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
            currentTime,
            duration,
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
        duration > 0
            ? Math.min(
                  100,
                  Math.max(
                      0,
                      (currentTime / duration) * 100
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
                        ? duration || item.duration || 0
                        : item.duration || 0;

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
        video.currentTime = 0;
        video.load();
        setCurrentTime(0);
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
                mediaItem.duration ?? 0,
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
            await startNativeNdi(
                mediaToPlay,
                video.currentTime || 0
            );
            await video.play();
            setIsPlaying(true);
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
        await window.santtosAPI.stopNdiFile();
        const video = videoRef.current;

        if (video) {
            video.pause();
            video.currentTime = 0;
        }

        setCurrentTime(0);
        setIsPlaying(false);
    }

    async function playNextMedia() {
        if (selectedMedia?.loop) {
            const video = videoRef.current;
            if (!video) {
                return;
            }

            video.currentTime = 0;
            await startNativeNdi(
                selectedMedia,
                0,
                true
            );
            await video.play();
            setIsPlaying(true);
            return;
        }

        if (!nextMedia) {
            setIsPlaying(false);
            await window.santtosAPI.stopNdiFile();
            return;
        }

        onSelectMedia(nextMedia);
        setCurrentTime(0);
        setDuration(0);
        await delay(120);

        const video = videoRef.current;
        if (!video) {
            return;
        }

        await startNativeNdi(nextMedia, 0);
        await video.play();
        setIsPlaying(true);
    }

    async function handleSeeked(
        video: HTMLVideoElement
    ) {
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
            hashtag: ""
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
                                        setCurrentTime(
                                            event.currentTarget.currentTime
                                        )
                                    }
                                    onLoadedMetadata={(event) =>
                                        setDuration(
                                            event.currentTarget.duration
                                        )
                                    }
                                    onDurationChange={(event) =>
                                        setDuration(
                                            event.currentTarget.duration
                                        )
                                    }
                                    onSeeked={(event) =>
                                        handleSeeked(
                                            event.currentTarget
                                        )
                                    }
                                    onEnded={playNextMedia}
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
                            onClick={playNextMedia}
                            disabled={!nextMedia}
                        >⏭</button>

                        <div className="program-time">
                            {formatDuration(currentTime)}
                            {" / "}
                            {formatDuration(duration)}
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
                        if (
                            event.dataTransfer.types.includes(
                                "application/x-santtos-library-media"
                            )
                        ) {
                            event.preventDefault();
                            event.dataTransfer.dropEffect =
                                "copy";
                        }
                    }}
                    onDrop={(event) => {
                        const mediaId =
                            event.dataTransfer.getData(
                                "application/x-santtos-library-media"
                            );

                        if (!mediaId) {
                            return;
                        }

                        event.preventDefault();
                        const item = media.find(
                            (entry) =>
                                entry.id === mediaId
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

                                                if (
                                                    isLibraryMedia ||
                                                    !isCurrent
                                                ) {
                                                    event.preventDefault();
                                                }
                                            }}
                                            onDrop={(event) => {
                                                event.preventDefault();
                                                event.stopPropagation();

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
                                                <strong>{item.name}</strong>
                                                <span>
                                                    {isCurrent
                                                        ? `${formatDuration(
                                                              currentTime
                                                          )} / ${formatDuration(
                                                              duration
                                                          )}`
                                                        : formatDuration(
                                                              item.duration
                                                          )}
                                                </span>

                                                <label
                                                    className="timeline-watermark-toggle"
                                                    onClick={(event) =>
                                                        event.stopPropagation()
                                                    }
                                                    onDoubleClick={(event) =>
                                                        event.stopPropagation()
                                                    }
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
                                                    <span>
                                                        Marca d'água
                                                    </span>
                                                </label>

                                                <div
                                                    className="timeline-hashtag-editor"
                                                    onClick={(event) =>
                                                        event.stopPropagation()
                                                    }
                                                    onDoubleClick={(event) =>
                                                        event.stopPropagation()
                                                    }
                                                >
                                                    <span>H</span>
                                                    <input
                                                        key={`${item.id}-${item.hashtag ?? ""}`}
                                                        defaultValue={
                                                            item.hashtag ?? ""
                                                        }
                                                        placeholder="#Hashtag"
                                                        maxLength={80}
                                                        onBlur={(event) =>
                                                            updateTimelineHashtag(
                                                                item.id,
                                                                event.currentTarget.value
                                                            )
                                                        }
                                                        onKeyDown={(event) => {
                                                            if (
                                                                event.key === "Enter"
                                                            ) {
                                                                event.currentTarget.blur();
                                                            }
                                                        }}
                                                    />
                                                </div>

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
                                                className="timeline-actions"
                                                onClick={(event) =>
                                                    event.stopPropagation()
                                                }
                                            >
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

            <div className="playout-library-column">
                <LibraryPanel
                    media={media}
                    isLoading={isLoading}
                    message={message}
                    onAddVideos={onAddVideos}
                    onRemoveMedia={onRemoveMedia}
                    onAddToTimeline={addTimelineItem}
                />
            </div>
        </div>
    );
}

interface LibraryPanelProps {
    media: MediaItem[];
    isLoading: boolean;
    message: string;
    onAddVideos: () => Promise<void>;
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
    onRemoveMedia,
    onAddToTimeline
}: LibraryPanelProps) {
    const [search, setSearch] =
        useState("");

    const filteredMedia = useMemo(() => {
        const normalized =
            search.trim().toLowerCase();

        if (!normalized) {
            return media;
        }

        return media.filter((item) =>
            item.name
                .toLowerCase()
                .includes(normalized)
        );
    }, [media, search]);

    return (
        <section className="panel module-panel">
            <div className="module-header">
                <div>
                    <div className="panel-title">
                        BIBLIOTECA
                    </div>
                    <h1>Biblioteca de mídia</h1>
                </div>

                <button
                    className="primary-button"
                    onClick={onAddVideos}
                    disabled={isLoading}
                >
                    {isLoading
                        ? "Importando..."
                        : "+ Adicionar vídeos"}
                </button>
            </div>

            <div className="library-toolbar">
                <input
                    className="search-input"
                    type="search"
                    value={search}
                    placeholder="Pesquisar vídeo..."
                    onChange={(event) =>
                        setSearch(event.target.value)
                    }
                />
                <span>
                    {filteredMedia.length} de {media.length} mídia(s)
                </span>
            </div>

            {message && (
                <div className="library-message">
                    {message}
                </div>
            )}

            {filteredMedia.length === 0 ? (
                <div className="empty-state">
                    Nenhum vídeo cadastrado
                </div>
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
                                event.dataTransfer.effectAllowed =
                                    "copy";
                                event.dataTransfer.setData(
                                    "application/x-santtos-library-media",
                                    item.id
                                );
                            }}
                        >
                            <div className="media-thumbnail">
                                {item.extension.toUpperCase()}
                            </div>

                            <div className="media-information">
                                <strong>{item.name}</strong>
                                <span>{item.path}</span>

                                <div className="media-metadata">
                                    <span>
                                        {item.width && item.height
                                            ? `${item.width}×${item.height}`
                                            : "Resolução desconhecida"}
                                    </span>
                                    <span>
                                        {item.videoCodec ??
                                            "Codec desconhecido"}
                                    </span>
                                    <span>
                                        {item.fps !== null
                                            ? `${item.fps.toFixed(3)} fps`
                                            : "FPS desconhecido"}
                                    </span>
                                    <span>
                                        {formatDuration(item.duration)}
                                    </span>
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
