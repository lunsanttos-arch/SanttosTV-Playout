import {
    useEffect,
    useMemo,
    useCallback,
    useRef,
    useState
} from "react";
import type { CSSProperties } from "react";
import BroadcastSettingsPanel from "./BroadcastSettingsPanel";
import OpecSchedulerPanel from "./OpecSchedulerPanel";
import WebInputsPanel from "./WebInputsPanel";
import ProgramAudioMeters from "./ProgramAudioMeters";
import type { NativeAudioStatus } from "./ProgramAudioMeters";
import { buildTimelineForecast, buildPlannedSchedule, buildFreezeCountdown, describeForecastEntry, formatEstimatedClock } from "./timeline-forecast";
import type { PlannedScheduleBlocker } from "./timeline-forecast";
import { EXHIBITION_OPTIONS, DEFAULT_EXHIBITION_STYLE, exhibitionLabel, exhibitionPreviewStyle, exhibitionText, normalizeExhibitionType } from "./exhibition";
import type { ExhibitionStyle, ExhibitionType } from "./exhibition";

type Panel =
    | "playout"
    | "library"
    | "scheduler"
    | "settings";

export interface MediaItem {
    id: string;
    sourceMediaId?: string;
    programmedStartTime?: string;
    sourceType?: "file" | "input";
    inputId?: string;
    inputProtocol?: string;
    inputTimingMode?: "duration" | "clock";
    inputEndTime?: string;
    inputEndAtMs?: number;
    fitMode?: "contain" | "cover" | "stretch";
    sizePercent?: number;
    premiumFeature?: boolean;
    loop?: boolean;
    freezeEnd?: boolean;
    watermark?: boolean;
    hashtag?: string;
    inPoint?: number;
    outPoint?: number | null;
    blockLabel?: string;
    exhibitionType?: ExhibitionType;
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

export interface RundownItem extends MediaItem {
    rundownItemId: string;
    sourceMediaId: string;
    notes: string;
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
    exhibitionStyle: ExhibitionStyle;
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

interface NativePlayoutStatus {
    generation: number;
    state: "IDLE" | "PLAYING" | "PAUSED" | "ENDED" | "FAULT";
    filePath: string | null;
    itemId: string | null;
    inPointSeconds: number;
    outPointSeconds: number | null;
    positionSeconds: number;
    remainingSeconds: number | null;
    active: boolean;
    paused: boolean;
    ended: boolean;
    error: string | null;
}

interface NdiCommandResult {
    ok: boolean;
    error?: string;
    filePath?: string;
    startSeconds?: number;
    playout?: NativePlayoutStatus;
}

interface SaveHashtagStyleResult {
    ok: boolean;
    hashtagStyle: HashtagStyle;
}

interface SaveExhibitionStyleResult {
    ok: boolean;
    exhibitionStyle: ExhibitionStyle;
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
            prepareMediaPreview: (filePath: string) => Promise<{
                ok: boolean;
                filePath?: string;
                error?: string;
            }>;
            getDroppedFilePath: (file: File) => string;
            removeMedia: (
                mediaId: string
            ) => Promise<RemoveResult>;
            getDailyRundown: (date: string) => Promise<{
                date: string;
                title: string;
                startTime: string;
                items: RundownItem[];
                updatedAt?: string | null;
            }>;
            saveDailyRundown: (rundown: {
                date: string;
                title: string;
                startTime: string;
                items: RundownItem[];
            }) => Promise<{
                ok: boolean;
                rundown: {
                    date: string;
                    title: string;
                    startTime: string;
                    items: RundownItem[];
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
            getWebInputs: () => Promise<{
                ok: boolean;
                inputs?: Array<{
                    id: string;
                    name: string;
                    url: string;
                    protocol: "http" | "https" | "hls" | "m3u8" | "srt";
                    timingMode: "duration" | "clock";
                    durationSeconds: number;
                    endTime: string;
                    fitMode: "contain" | "cover" | "stretch";
                    sizePercent: number;
                    premiumFeature: true;
                    createdAt: string;
                }>;
                error?: string;
            }>;
            saveWebInput: (input: unknown) => Promise<{
                ok: boolean;
                input?: unknown;
                inputs?: any[];
                error?: string;
            }>;
            removeWebInput: (id: string) => Promise<{
                ok: boolean;
                removed?: boolean;
                inputs?: any[];
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
            saveExhibitionStyle: (
                style: ExhibitionStyle
            ) => Promise<SaveExhibitionStyleResult>;
            getNdiStatus: () => Promise<{
                online: boolean;
                source: string;
                nativePlaybackActive?: boolean;
                playoutError?: string | null;
                error?: string | null;
                restarting?: boolean;
                testBench?: boolean;
                ndiTestMode?: boolean;
                audio?: NativeAudioStatus;
                playout?: NativePlayoutStatus;
            }>;
            playNdiFile: (
                filePath: string,
                startSeconds?: number,
                hashtag?: string,
                overlayState?: {
                    durationSeconds?: number;
                    inPointSeconds?: number;
                    itemId?: string;
                    watermarkEnabled?: boolean;
                    exhibitionType?: ExhibitionType;
                    watermarkFadeIn?: boolean;
                    watermarkFadeOut?: boolean;
                    hashtagFadeIn?: boolean;
                    hashtagFadeOut?: boolean;
                    videoStreamIndex?: number | null;
                    audioStreamIndex?: number | null;
                    timingMode?: string;
                    outPointSeconds?: number | null;
                    sourceType?: "file" | "input";
                    fitMode?: "contain" | "cover" | "stretch";
                    sizePercent?: number;
                }
            ) => Promise<NdiCommandResult>;
            getWatermarkPreview: (
                filePath: string
            ) => Promise<{
                ok: boolean;
                dataUrl?: string;
                error?: string;
            }>;
            pauseNdiFile: () => Promise<NdiCommandResult>;
            seekNdiFile: (
                positionSeconds: number
            ) => Promise<NdiCommandResult>;
            stopNdiFile: () => Promise<NdiCommandResult>;
            onNativePlayoutEnded: (
                callback: (status: NativePlayoutStatus) => void
            ) => () => void;
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
            selectPlayoutReportFolder: () => Promise<{
                ok: boolean;
                canceled?: boolean;
                folder?: string;
                error?: string;
            }>;
            resetPlayoutReportFolder: () => Promise<{
                ok: boolean;
                folder?: string;
                error?: string;
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
    const [ndiError, setNdiError] = useState<string | null>(null);
    const [testBench, setTestBench] = useState(false);
    const [ndiTestMode, setNdiTestMode] = useState(false);
    const [audioStatus, setAudioStatus] = useState<NativeAudioStatus>({ state: "IDLE" });
    const [nativePlaybackActive, setNativePlaybackActive] = useState(false);
    const [nativePlayout, setNativePlayout] = useState<NativePlayoutStatus>({
        generation: 0,
        state: "IDLE",
        filePath: null,
        itemId: null,
        inPointSeconds: 0,
        outPointSeconds: null,
        positionSeconds: 0,
        remainingSeconds: null,
        active: false,
        paused: false,
        ended: false,
        error: null
    });
    const [playoutError, setPlayoutError] = useState<string | null>(null);
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
    const [exhibitionStyle, setExhibitionStyle] =
        useState<ExhibitionStyle>(DEFAULT_EXHIBITION_STYLE);
    const [programmedRemainingSeconds, setProgrammedRemainingSeconds] =
        useState(0);
    const [programmedBlocker, setProgrammedBlocker] =
        useState<PlannedScheduleBlocker>(null);
    const [programmedEndAtMs, setProgrammedEndAtMs] =
        useState<number | null>(null);
    const [programmedHasFreeze, setProgrammedHasFreeze] =
        useState(false);
    const [programmedFreezeSeconds, setProgrammedFreezeSeconds] =
        useState<number | null>(null);
    const [programmedLive, setProgrammedLive] = useState(false);
    const [rundownApplyRequest, setRundownApplyRequest] = useState<{
        key: number;
        items: MediaItem[];
        startTime: string;
    } | null>(null);

    // Stable callback: updating the top-bar clock must not retrigger the
    // playout forecast effect or move the predicted entry times.
    const handleScheduleSummary = useCallback((
        remainingSeconds: number | null,
        blocker: PlannedScheduleBlocker,
        endsAtMs: number | null,
        hasFreeze: boolean,
        freezeSeconds: number | null,
        live: boolean
    ) => {
        setProgrammedRemainingSeconds(remainingSeconds ?? 0);
        setProgrammedBlocker(blocker);
        setProgrammedEndAtMs(endsAtMs);
        setProgrammedHasFreeze(hasFreeze);
        setProgrammedFreezeSeconds(freezeSeconds);
        setProgrammedLive(live);
    }, []);

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
                setTestBench(Boolean(status.testBench));
                setNdiTestMode(Boolean(status.ndiTestMode));
                setAudioStatus(status.audio ?? { state: "IDLE" });
                setNdiError(status.error ?? null);
                setNativePlaybackActive(Boolean(status.nativePlaybackActive));
                if (status.playout) {
                    setNativePlayout(status.playout);
                }
                setPlayoutError(status.playoutError ?? null);
            } catch {
                setNdiOnline(false);
                setNativePlaybackActive(false);
                setNdiError("Falha ao consultar o engine NDI.");
                setAudioStatus({ state: "ERROR", error: "NDI não responde" });
            }
        };

        updateNdiStatus();
        const timer = window.setInterval(
            updateNdiStatus,
            250
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
                setExhibitionStyle(
                    settings.exhibitionStyle ?? DEFAULT_EXHIBITION_STYLE
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

    async function saveExhibitionStyle(style: ExhibitionStyle) {
        const result = await window.santtosAPI.saveExhibitionStyle(style);
        if (!result.ok) {
            throw new Error("Não foi possível salvar a identificação no vídeo.");
        }
        setExhibitionStyle(result.exhibitionStyle);
    }

    const programmedDurationLabel =
        programmedHasFreeze
            ? programmedFreezeSeconds !== null
                ? formatProgrammedDuration(programmedFreezeSeconds)
                : "SEM PREVISÃO"
            : programmedBlocker === "loop" ? "LOOP"
            : programmedBlocker !== null ? "SEM PREVISÃO"
            : programmedEndAtMs !== null
              ? formatProgrammedDuration(programmedRemainingSeconds)
              : "--:--:--";
    const programmedDurationTitle =
        programmedHasFreeze
            ? "ATÉ FREEZE"
            : "PROGRAMADO";
    const programmedUntilLabel =
        programmedBlocker !== null ? "SEM PREVISÃO"
            : programmedEndAtMs !== null
              ? formatEstimatedClock(programmedEndAtMs, Date.now())
              : programmedLive
                ? "SEM PREVISÃO"
                : "AGUARDANDO REPRODUÇÃO";

    return (
        <div className="app-shell">
            <header className="topbar">
                <div className="brand">
                    <img
                        className="brand-logo"
                        src="./brand/logo-horizontal.webp"
                        alt="Santtos Playout"
                    />
                </div>

                <div className="header-time-center">
                    <div className="master-clock">
                        {clock}
                    </div>
                    <div
                        className={
                            programmedHasFreeze
                                ? "programmed-time-summary has-freeze"
                                : "programmed-time-summary"
                        }
                        title={
                            programmedHasFreeze
                                ? programmedFreezeSeconds !== null
                                    ? `Próximo FREEZE em ${formatProgrammedDuration(programmedFreezeSeconds)}.`
                                    : "Existe um FREEZE adiante, mas o tempo até ele não pode ser previsto."
                                : undefined
                        }
                    >
                        <div>
                            <span>{programmedDurationTitle}</span>
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
                        {ndiTestMode ? "● BANCADA NDI — FONTE QA"
                          : testBench ? "● BANCADA ISOLADA — SEM NDI"
                          : "● SISTEMA ONLINE"}
                    </span>
                    <span
                        title={ndiError ?? undefined}
                        className={ndiOnline ? "status-online" : ""}
                    >
                        {testBench && !ndiTestMode
                            ? "● PRÉVIA DE TESTE"
                            : ndiOnline
                              ? audioStatus.state === "FLOWING"
                                  ? "● NDI ONLINE — VÍDEO E PCM ESTÉREO"
                                  : "● NDI ONLINE — ÁUDIO: " + audioStatus.state
                            : ndiError
                              ? `● NDI OFFLINE: ${ndiError}`
                              : "● NDI OFFLINE"}
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
                            testBench={testBench}
                            ndiTestMode={ndiTestMode}
                            audioStatus={audioStatus}
                            ndiOnline={ndiOnline}
                            nativePlaybackActive={nativePlaybackActive}
                            nativePlayout={nativePlayout}
                            playoutError={playoutError}
                            media={media}
                            isLoading={isLoading}
                            message={message}
                            selectedMedia={selectedMedia}
                            hashtagStyle={hashtagStyle}
                            exhibitionStyle={exhibitionStyle}
                            onSelectMedia={setSelectedMedia}
                            onAddVideos={addVideos}
                            onImportDroppedFiles={importDroppedFiles}
                            onRemoveMedia={handleRemoveMedia}
                            rundownApplyRequest={rundownApplyRequest}
                            onScheduleSummary={handleScheduleSummary}
                        />
                    </div>

                    {activePanel === "scheduler" && (
                        <OpecSchedulerPanel
                            media={media}
                            onApply={(items, startTime) => {
                                setRundownApplyRequest({
                                    key: Date.now(),
                                    items: items as MediaItem[],
                                    startTime: startTime || "00:00"
                                });
                                setActivePanel("playout");
                            }}
                        />
                    )}

                    {activePanel === "settings" && (
                        <BroadcastSettingsPanel
                            hashtagStyle={hashtagStyle}
                            onSaveHashtag={saveHashtagStyle}
                            exhibitionStyle={exhibitionStyle}
                            onSaveExhibition={saveExhibitionStyle}
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
        { panel: "scheduler", icon: "🗓", label: "Programação" },
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
    testBench: boolean;
    ndiTestMode: boolean;
    audioStatus: NativeAudioStatus;
    ndiOnline: boolean;
    nativePlaybackActive: boolean;
    nativePlayout: NativePlayoutStatus;
    playoutError: string | null;
    media: MediaItem[];
    isLoading: boolean;
    message: string;
    selectedMedia: MediaItem | null;
    hashtagStyle: HashtagStyle;
    exhibitionStyle: ExhibitionStyle;
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
        startTime: string;
    } | null;
    onScheduleSummary: (
        remainingSeconds: number | null,
        blocker: PlannedScheduleBlocker,
        endsAtMs: number | null,
        hasFreeze: boolean,
        freezeSeconds: number | null,
        live: boolean
    ) => void;
}

function PlayoutPanel({
    testBench,
    ndiTestMode,
    audioStatus,
    ndiOnline,
    nativePlaybackActive,
    nativePlayout,
    playoutError,
    media,
    isLoading,
    message,
    selectedMedia,
    hashtagStyle,
    exhibitionStyle,
    onSelectMedia,
    onAddVideos,
    onImportDroppedFiles,
    onRemoveMedia,
    rundownApplyRequest,
    onScheduleSummary
}: PlayoutPanelProps) {
    const videoRef =
        useRef<HTMLVideoElement | null>(null);
    const nativeOutputEnabled = !testBench || ndiTestMode;
    const timelineLoadedRef = useRef(false);
    const previousStyleRef = useRef(
        JSON.stringify(hashtagStyle)
    );

    const [currentTime, setCurrentTime] =
        useState(0);
    const [timelineClock, setTimelineClock] = useState(() => Date.now());

    useEffect(() => {
        const interval = window.setInterval(() => setTimelineClock(Date.now()), 1000);
        return () => window.clearInterval(interval);
    }, []);
    const [duration, setDuration] =
        useState(0);
    const [isPlaying, setIsPlaying] =
        useState(false);
    const [pendingSeek, setPendingSeek] =
        useState<number | null>(null);
    const ndiWasOnlineRef = useRef(false);
    const nativePlaybackWasActiveRef = useRef(false);
    const resumeAfterNdiLossRef = useRef(false);
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
    const [previewProxyBySource, setPreviewProxyBySource] =
        useState<Record<string, string>>({});
    const [previewError, setPreviewError] = useState("");
    const [previewPreparing, setPreviewPreparing] = useState(false);
    const [editingFilm, setEditingFilm] =
        useState<MediaItem | null>(null);
    const clipAdvanceGuardRef = useRef(false);
    const [freezeHoldItemId, setFreezeHoldItemId] =
        useState<string | null>(null);
    const activeReportIdRef = useRef<string | null>(null);
    const lastProgressRef = useRef({
        position: Number.NaN,
        atMs: Date.now()
    });

    function markPlaybackSample(video: HTMLVideoElement) {
        const sampledAtMs = Date.now();
        const position = video.currentTime;
        lastProgressRef.current = { position, atMs: sampledAtMs };
        setCurrentTime(position);
        setTimelineClock(sampledAtMs);
    }

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
                programmedStartTime:
                    rundownApplyRequest.startTime ||
                    "00:00",
                loop: false,
                freezeEnd: Boolean(item.freezeEnd),
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
            // Aplicar uma Programação substitui tudo que ainda não foi ao ar.
            // Somente o item que está efetivamente NO AR é preservado.
            setTimelineQueue([
                selectedMedia,
                ...prepared
            ]);
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
                .map((entry): MediaItem | null => {
                    if (
                        entry.sourceType === "input"
                    ) {
                        return entry;
                    }

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
                        programmedStartTime:
                            entry.programmedStartTime ??
                            "00:00",
                        loop: Boolean(entry.loop),
                        freezeEnd: Boolean(entry.freezeEnd),
                        watermark: Boolean(entry.watermark),
                        hashtag: entry.hashtag ?? "",
                        inPoint: normalizeClipPoint(entry.inPoint, 0),
                        outPoint: normalizeClipOutPoint(
                            entry.outPoint,
                            source.duration
                        ),
                        blockLabel: entry.blockLabel ?? "",
                        exhibitionType: normalizeExhibitionType(entry.exhibitionType)
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
        selectedMedia &&
        selectedMedia.sourceType !== "input"
            ? window.santtosAPI.getMediaFileUrl(
                  previewProxyBySource[selectedMedia.path] ||
                      selectedMedia.path
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

    const programVideo = videoRef.current;
    const nativeEngineOwnsProgram = Boolean(
        nativeOutputEnabled &&
        selectedMedia &&
        nativePlayout.itemId === selectedMedia.id
    );
    const forecastRunning = nativeOutputEnabled
        ? Boolean(
              nativeEngineOwnsProgram &&
              nativePlayout.state === "PLAYING" &&
              ndiOnline &&
              nativePlaybackActive
          )
        : Boolean(
              isPlaying &&
              programVideo &&
              !programVideo.paused &&
              !programVideo.seeking &&
              programVideo.readyState >= 2 &&
              Math.abs(timelineClock - lastProgressRef.current.atMs) <= 4000
          );
    const programmedStartTime =
        timelineQueue.find(
            (item) =>
                typeof item.programmedStartTime ===
                    "string"
        )?.programmedStartTime ??
        "00:00";

    const plannedSchedule =
        buildPlannedSchedule(
            timelineQueue,
            programmedStartTime
        );

    const timelineForecast = buildTimelineForecast(
        timelineQueue,
        selectedMedia?.id ?? null,
        {
            nowMs: timelineClock,
            isRunning: forecastRunning,
            currentTime,
            sampledAtMs: lastProgressRef.current.atMs,
            holdingAtEnd:
                Boolean(
                    selectedMedia &&
                    selectedMedia.freezeEnd &&
                    freezeHoldItemId === selectedMedia.id
                )
        }
    );

    const freezeCountdown = buildFreezeCountdown(
        timelineQueue,
        selectedMedia?.id ?? null,
        currentTime
    );

    function describeForecast(item: MediaItem | null, isCurrent = false): string {
        if (!item) return "Nenhum próximo vídeo";
        return describeForecastEntry(
            timelineForecast.entries.get(item.id),
            timelineClock,
            isCurrent
        );
    }

    useEffect(() => {
        let programmedEndAtMs: number | null = null;

        if (
            plannedSchedule.totalSeconds !== null
        ) {
            const startParts =
                programmedStartTime
                    .split(":")
                    .map(Number);
            const start =
                new Date();
            start.setHours(
                startParts[0] || 0,
                startParts[1] || 0,
                0,
                0
            );

            programmedEndAtMs =
                start.getTime() +
                plannedSchedule.totalSeconds *
                    1000;
        }

        onScheduleSummary(
            plannedSchedule.totalSeconds,
            plannedSchedule.blocker,
            programmedEndAtMs,
            freezeCountdown.hasUpcomingFreeze,
            freezeCountdown.seconds,
            true
        );
    }, [
        plannedSchedule.totalSeconds,
        plannedSchedule.end,
        plannedSchedule.blocker,
        freezeCountdown.hasUpcomingFreeze,
        freezeCountdown.seconds,
        programmedStartTime,
        onScheduleSummary
    ]);

    useEffect(() => {
        if (
            !nativeOutputEnabled ||
            !selectedMedia ||
            nativePlayout.itemId !== selectedMedia.id
        ) {
            return;
        }

        const inPoint = getClipIn(selectedMedia);
        const outPoint = getClipOut(selectedMedia);
        const position = Math.min(
            outPoint,
            Math.max(inPoint, nativePlayout.positionSeconds)
        );
        const sampledAtMs = Date.now();

        if (pendingSeek === null) {
            setCurrentTime(position);
        }
        setTimelineClock(sampledAtMs);
        lastProgressRef.current = {
            position,
            atMs: sampledAtMs
        };

        const video = videoRef.current;
        if (!video) return;

        if (
            nativePlayout.state === "PLAYING" &&
            video.paused
        ) {
            if (
                Number.isFinite(position) &&
                Math.abs(video.currentTime - position) > 0.5
            ) {
                video.currentTime = position;
            }

            void video.play().catch(() => {
                // A prévia Chromium é auxiliar. Falha nela não derruba PROGRAM.
            });
        } else if (nativePlayout.state !== "PLAYING") {
            video.pause();
            if (
                Number.isFinite(position) &&
                Math.abs(video.currentTime - position) > 0.5
            ) {
                video.currentTime = position;
            }
        }

        setIsPlaying(nativePlayout.state === "PLAYING");
    }, [
        nativeOutputEnabled,
        nativePlayout.generation,
        nativePlayout.state,
        nativePlayout.positionSeconds,
        nativePlayout.itemId,
        selectedMedia?.id,
        pendingSeek
    ]);

    useEffect(() => {
        setPreviewError("");
    }, [selectedMedia?.path]);

    async function prepareBrowserPreview() {
        if (
            !selectedMedia ||
            selectedMedia.sourceType === "input" ||
            previewPreparing
        ) return;
        if (isPlaying && !testBench) {
            setPreviewError("Pare o PROGRAM antes de preparar uma prévia compatível.");
            return;
        }
        const sourcePath = selectedMedia.path;
        setPreviewPreparing(true);
        setPreviewError("");
        try {
            const result = await window.santtosAPI.prepareMediaPreview(sourcePath);
            if (!result.ok || !result.filePath) {
                throw new Error(result.error || "Falha ao gerar prévia MP4.");
            }
            setPreviewProxyBySource((current) => ({
                ...current,
                [sourcePath]: result.filePath!
            }));
        } catch (error) {
            console.error("Falha ao preparar prévia MP4:", error);
            setPreviewError(error instanceof Error ? error.message : String(error));
        } finally {
            setPreviewPreparing(false);
        }
    }

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
        lastProgressRef.current = { position: inPoint, atMs: Date.now() };
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
            inPointSeconds:
                getClipIn(mediaItem),
            itemId:
                mediaItem.id,
            outPointSeconds:
                getClipOut(mediaItem),
            watermarkEnabled:
                Boolean(mediaItem.watermark),
            exhibitionType:
                normalizeExhibitionType(mediaItem.exhibitionType),
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
                mediaItem.timingMode ?? "unknown",
            sourceType:
                mediaItem.sourceType ?? "file",
            fitMode:
                mediaItem.fitMode ?? "contain",
            sizePercent:
                mediaItem.sizePercent ?? 100
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

        const authoritativeTime =
            nativeOutputEnabled &&
            mediaItem &&
            nativePlayout.itemId === mediaItem.id
                ? nativePlayout.positionSeconds
                : videoRef.current?.currentTime ?? currentTime;
        const playedSeconds = forcedPlayedSeconds ?? Math.max(
            0,
            authoritativeTime - getClipIn(mediaItem)
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
        if (!nativeOutputEnabled) return;
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

    // Só FAULT real do motor derruba o PROGRAM. PAUSED pode ser uma
    // interrupção recuperável do NDI e não deve marcar o conteúdo como pulado.
    useEffect(() => {
        if (!nativeOutputEnabled) return;

        if (nativePlaybackActive) {
            nativePlaybackWasActiveRef.current = true;
        }

        if (
            nativePlayout.state === "FAULT" &&
            isPlaying
        ) {
            const video = videoRef.current;
            video?.pause();
            setIsPlaying(false);
            nativePlaybackWasActiveRef.current = false;
            void finishExecutionReport("PULADO", selectedMedia);
            console.error(
                "Falha no motor de playout:",
                nativePlayout.error ?? playoutError
            );
        }
    }, [
        nativePlaybackActive,
        nativePlayout.state,
        nativePlayout.error,
        testBench
    ]);

    // Nao deixa o monitor continuar consumindo comerciais enquanto o sinal
    // NDI esta fora do ar. Quando o sender retorna, resincroniza no timecode
    // exato em que o monitor foi pausado.
    useEffect(() => {
        if (!nativeOutputEnabled) return;
        const video = videoRef.current;
        if (!ndiOnline) {
            if (
                ndiWasOnlineRef.current &&
                isPlaying
            ) {
                video?.pause();
                resumeAfterNdiLossRef.current = true;
            }
            ndiWasOnlineRef.current = false;
            return;
        }

        ndiWasOnlineRef.current = true;
        if (!resumeAfterNdiLossRef.current) return;
        if (
            !selectedMedia ||
            (
                selectedMedia.sourceType !== "input" &&
                !video
            )
        ) {
            return;
        }

        resumeAfterNdiLossRef.current = false;
        void (async () => {
            const resumeAt =
                nativePlayout.itemId === selectedMedia.id
                    ? nativePlayout.positionSeconds
                    : currentTime;
            const mediaToResume =
                resolveInputClockTiming(
                    selectedMedia,
                    resumeAt
                );
            onSelectMedia(
                mediaToResume
            );
            await startNativeNdi(
                mediaToResume,
                resumeAt
            );
            setCurrentTime(resumeAt);
            setIsPlaying(true);
            await video
                ?.play()
                .catch(() => undefined);
        })().catch((error) => {
            console.error("Falha ao retomar sinal NDI:", error);
            video?.pause();
            setIsPlaying(false);
            void finishExecutionReport("PULADO", selectedMedia);
            window.alert("O NDI foi restabelecido, mas nao foi possivel retomar o PROGRAM. Verifique o sinal e reinicie o motor.");
        });
    }, [ndiOnline, testBench]);

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
                nativeOutputEnabled &&
                nativePlayout.itemId === selectedMedia.id
                    ? nativePlayout.positionSeconds
                    : currentTime
            ).catch((error) =>
                console.error(
                    "Erro ao aplicar estilo do GC no NDI:",
                    error
                )
            );
        }
    }, [hashtagStyle]);

    function resolveInputClockTiming(
        item: MediaItem,
        resumePosition = 0
    ): MediaItem {
        if (
            item.sourceType !== "input" ||
            item.inputTimingMode !== "clock" ||
            !item.inputEndTime
        ) {
            return item;
        }

        const now = Date.now();
        let endAt =
            Number(item.inputEndAtMs);

        if (
            !Number.isFinite(endAt) ||
            endAt <= 0
        ) {
            const [hours, minutes, seconds] =
                item.inputEndTime
                    .split(":")
                    .map(Number);
            const end =
                new Date(now);

            end.setHours(
                hours || 0,
                minutes || 0,
                seconds || 0,
                0
            );

            if (
                end.getTime() <= now
            ) {
                end.setDate(
                    end.getDate() + 1
                );
            }

            endAt =
                end.getTime();
        }

        const remaining =
            Math.max(
                0.05,
                (endAt - now) /
                    1000
            );
        const nextOut =
            Math.max(
                resumePosition,
                0
            ) +
            remaining;

        const updated: MediaItem = {
            ...item,
            inputEndAtMs:
                endAt,
            duration:
                nextOut,
            inPoint: 0,
            outPoint:
                nextOut
        };

        setTimelineQueue(
            (current) =>
                current.map(
                    (entry) =>
                        entry.id ===
                        item.id
                            ? updated
                            : entry
                )
        );

        return updated;
    }

    async function playVideo() {
        let mediaToPlay = selectedMedia;

        if (
            mediaToPlay &&
            freezeHoldItemId === mediaToPlay.id
        ) {
            setFreezeHoldItemId(null);
            clipAdvanceGuardRef.current = false;
        }

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

        mediaToPlay =
            resolveInputClockTiming(
                mediaToPlay,
                nativeOutputEnabled &&
                nativePlayout.itemId ===
                    mediaToPlay.id &&
                nativePlayout.state ===
                    "PAUSED"
                    ? nativePlayout.positionSeconds
                    : 0
            );

        if (
            selectedMedia?.id ===
            mediaToPlay.id
        ) {
            onSelectMedia(
                mediaToPlay
            );
        }

        const clipIn = getClipIn(mediaToPlay);
        const clipOut = getClipOut(mediaToPlay);
        const resumeAt =
            nativeOutputEnabled &&
            nativePlayout.itemId === mediaToPlay.id &&
            nativePlayout.state === "PAUSED"
                ? nativePlayout.positionSeconds
                : Number.isFinite(currentTime) &&
                  currentTime >= clipIn &&
                  currentTime < clipOut
                    ? currentTime
                    : clipIn;

        try {
            if (nativeOutputEnabled) {
                // PROGRAM nasce no motor nativo. O Chromium é apenas preview.
                await startNativeNdi(
                    mediaToPlay,
                    resumeAt
                );
                setCurrentTime(resumeAt);
                lastProgressRef.current = {
                    position: resumeAt,
                    atMs: Date.now()
                };
                setIsPlaying(true);
                setPreviewError("");
                await startExecutionReport(mediaToPlay);

                if (video) {
                    try {
                        video.currentTime = resumeAt;
                        await video.play();
                    } catch {
                        setPreviewError(
                            "A prévia Chromium não conseguiu acompanhar o PROGRAM. " +
                            "O motor nativo continua no ar normalmente."
                        );
                    }
                }
                return;
            }

            if (!video) return;
            if (
                !Number.isFinite(video.currentTime) ||
                video.currentTime < clipIn ||
                video.currentTime >= clipOut
            ) {
                video.currentTime = clipIn;
            }
            await video.play();
            setPreviewError("");
            markPlaybackSample(video);
            setIsPlaying(true);
            await startExecutionReport(mediaToPlay);
        } catch (error) {
            console.error("Falha ao iniciar vídeo:", error);
            video?.pause();
            setIsPlaying(false);
            if (nativeOutputEnabled) {
                try { await window.santtosAPI.stopNdiFile(); }
                catch (stopError) { console.error(stopError); }
            }
            window.alert(
                `Não foi possível iniciar o PROGRAM.\n\n${String(error)}`
            );
        }
    }

    async function pauseVideo() {
        const video = videoRef.current;
        video?.pause();

        if (nativeOutputEnabled) {
            const result = await window.santtosAPI.pauseNdiFile();
            if (result.playout) {
                setCurrentTime(result.playout.positionSeconds);
                lastProgressRef.current = {
                    position: result.playout.positionSeconds,
                    atMs: Date.now()
                };
            }
        }

        setIsPlaying(false);
    }

    async function stopVideo() {
        const wasHolding =
            Boolean(
                selectedMedia &&
                freezeHoldItemId === selectedMedia.id
            );

        await finishExecutionReport(
            wasHolding ? "EXECUTADO" : "PULADO",
            selectedMedia,
            wasHolding
                ? getClipDuration(selectedMedia)
                : undefined
        );
        setFreezeHoldItemId(null);

        if (nativeOutputEnabled) {
            await window.santtosAPI.stopNdiFile();
        }

        const video = videoRef.current;
        const inPoint = getClipIn(selectedMedia);

        if (video) {
            video.pause();
            video.currentTime = inPoint;
        }

        setCurrentTime(inPoint);
        lastProgressRef.current = {
            position: inPoint,
            atMs: Date.now()
        };
        setIsPlaying(false);
    }

    async function seekProgram(relativeSeconds: number) {
        if (!selectedMedia) return;

        const clipIn = getClipIn(selectedMedia);
        const clipDuration = getClipDuration(selectedMedia);
        const relative = Math.min(
            clipDuration,
            Math.max(0, relativeSeconds)
        );
        const absolute = clipIn + relative;
        const video = videoRef.current;

        setPendingSeek(null);
        setCurrentTime(absolute);
        lastProgressRef.current = {
            position: absolute,
            atMs: Date.now()
        };

        if (video) {
            video.currentTime = absolute;
        }

        if (!nativeOutputEnabled) {
            return;
        }

        if (isPlaying) {
            await startNativeNdi(
                selectedMedia,
                absolute
            );
        } else {
            await window.santtosAPI.seekNdiFile(
                absolute
            );
        }
    }

    function holdLastFrame(mediaItem: MediaItem) {
        const outPoint = getClipOut(mediaItem);
        const sampledAtMs = Date.now();
        const video = videoRef.current;

        if (video) {
            video.pause();
            if (Number.isFinite(outPoint)) {
                try {
                    video.currentTime = Math.max(
                        getClipIn(mediaItem),
                        outPoint - 0.001
                    );
                } catch {
                    // O frame nativo já permanece no PROGRAM/NDI.
                }
            }
        }

        setFreezeHoldItemId(mediaItem.id);
        setCurrentTime(outPoint);
        lastProgressRef.current = {
            position: outPoint,
            atMs: sampledAtMs
        };
        setTimelineClock(sampledAtMs);
        setIsPlaying(false);
    }

    async function playNextMedia(
        reason: "completed" | "skipped" = "skipped"
    ) {
        setFreezeHoldItemId(null);

        await finishExecutionReport(
            reason === "completed" ? "EXECUTADO" : "PULADO",
            selectedMedia,
            reason === "completed"
                ? getClipDuration(selectedMedia)
                : undefined
        );

        if (selectedMedia?.loop) {
            const clipIn = getClipIn(selectedMedia);
            if (nativeOutputEnabled) {
                await startNativeNdi(
                    selectedMedia,
                    clipIn,
                    true
                );
            }

            const video = videoRef.current;
            if (video) {
                video.currentTime = clipIn;
                void video.play().catch(() => undefined);
            }

            setCurrentTime(clipIn);
            lastProgressRef.current = {
                position: clipIn,
                atMs: Date.now()
            };
            setIsPlaying(true);
            clipAdvanceGuardRef.current = false;
            await startExecutionReport(selectedMedia);
            return;
        }

        if (!nextMedia) {
            setIsPlaying(false);
            if (nativeOutputEnabled) {
                await window.santtosAPI.stopNdiFile();
            }
            return;
        }

        const nextToPlay =
            resolveInputClockTiming(
                nextMedia,
                0
            );

        onSelectMedia(
            nextToPlay
        );
        const nextIn =
            getClipIn(nextToPlay);
        setCurrentTime(nextIn);
        setDuration(
            getClipDuration(
                nextToPlay
            )
        );
        clipAdvanceGuardRef.current = false;
        await delay(120);

        if (nativeOutputEnabled) {
            await startNativeNdi(
                nextToPlay,
                nextIn
            );
        }

        const video = videoRef.current;
        if (video) {
            video.currentTime = nextIn;
            if (!nativeOutputEnabled) {
                await video.play();
            } else {
                void video.play().catch(() => undefined);
            }
        }

        lastProgressRef.current = {
            position: nextIn,
            atMs: Date.now()
        };
        setIsPlaying(true);
        await startExecutionReport(nextToPlay);
    }

    useEffect(() => {
        if (!nativeOutputEnabled) return;

        const unsubscribe =
            window.santtosAPI.onNativePlayoutEnded(
                (status) => {
                    if (
                        !selectedMedia ||
                        status.itemId !== selectedMedia.id ||
                        clipAdvanceGuardRef.current
                    ) {
                        return;
                    }

                    clipAdvanceGuardRef.current = true;

                    if (selectedMedia.freezeEnd) {
                        holdLastFrame(selectedMedia);
                        return;
                    }

                    void playNextMedia("completed").catch(
                        (error) => {
                            console.error(
                                "Falha ao avançar o motor nativo:",
                                error
                            );
                            setIsPlaying(false);
                        }
                    );
                }
            );

        return unsubscribe;
    }, [
        nativeOutputEnabled,
        selectedMedia?.id,
        nextMedia?.id,
        selectedMedia?.loop,
        selectedMedia?.freezeEnd
    ]);

    async function handleProgramTimeUpdate(
        video: HTMLVideoElement
    ) {
        // Em produção, o relógio vem do NativePlayoutEngine.
        if (nativeOutputEnabled) {
            return;
        }

        const position = video.currentTime;
        const sampledAtMs = Date.now();
        if (Number.isFinite(position) && (
            !Number.isFinite(lastProgressRef.current.position) ||
            position > lastProgressRef.current.position + 0.015 ||
            position < lastProgressRef.current.position - 0.1
        )) {
            lastProgressRef.current = {
                position,
                atMs: sampledAtMs
            };
        }
        setCurrentTime(position);
        setTimelineClock(sampledAtMs);

        if (!selectedMedia) return;

        const outPoint = getClipOut(selectedMedia);
        if (
            isPlaying &&
            !video.paused &&
            outPoint > getClipIn(selectedMedia) + 0.04 &&
            video.currentTime >= outPoint - 0.035 &&
            !clipAdvanceGuardRef.current
        ) {
            clipAdvanceGuardRef.current = true;

            if (selectedMedia.freezeEnd) {
                holdLastFrame(selectedMedia);
                return;
            }

            await playNextMedia("completed");
        }
    }

    function parseDraggedTimelineItem(
        raw: string
    ): MediaItem | null {
        if (!raw) return null;

        try {
            const value =
                JSON.parse(raw) as Partial<MediaItem>;

            if (
                value.sourceType !== "input" ||
                typeof value.inputId !== "string" ||
                typeof value.name !== "string" ||
                typeof value.path !== "string" ||
                !/^(https?:\/\/|srt:\/\/)/i.test(
                    value.path
                )
            ) {
                return null;
            }

            const duration =
                Number(value.duration);

            if (
                !Number.isFinite(duration) ||
                duration <= 0
            ) {
                return null;
            }

            return {
                ...(value as MediaItem),
                sourceType: "input",
                fileSize: 0,
                duration,
                loop: false,
                freezeEnd: false,
                watermark: false,
                hashtag:
                    typeof value.hashtag === "string"
                        ? value.hashtag
                        : "",
                inPoint: 0,
                outPoint: duration,
                status: "stream"
            };
        } catch {
            return null;
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
            freezeEnd: false,
            watermark: false,
            hashtag: "",
            inPoint: 0,
            outPoint: mediaItem.duration ?? null,
            blockLabel:
                mediaItem.sourceType === "input"
                    ? mediaItem.blockLabel ?? "INPUT"
                    : "",
            exhibitionType: "NORMAL",
            fitMode:
                mediaItem.fitMode ?? "contain",
            sizePercent:
                mediaItem.sizePercent ?? 100
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
        const enabling =
            !Boolean(
                timelineQueue.find(
                    (item) => item.id === mediaId
                )?.loop
            );

        setTimelineQueue((current) =>
            current.map((item) =>
                item.id === mediaId
                    ? {
                          ...item,
                          loop: enabling,
                          freezeEnd:
                              enabling
                                  ? false
                                  : Boolean(item.freezeEnd)
                      }
                    : item
            )
        );

        if (selectedMedia?.id === mediaId) {
            onSelectMedia({
                ...selectedMedia,
                loop: enabling,
                freezeEnd:
                    enabling
                        ? false
                        : Boolean(selectedMedia.freezeEnd)
            });
        }
    }

    function toggleTimelineFreeze(mediaId: string) {
        const enabling =
            !Boolean(
                timelineQueue.find(
                    (item) => item.id === mediaId
                )?.freezeEnd
            );

        setTimelineQueue((current) =>
            current.map((item) =>
                item.id === mediaId
                    ? {
                          ...item,
                          freezeEnd: enabling,
                          loop:
                              enabling
                                  ? false
                                  : Boolean(item.loop)
                      }
                    : item
            )
        );

        if (selectedMedia?.id === mediaId) {
            onSelectMedia({
                ...selectedMedia,
                freezeEnd: enabling,
                loop:
                    enabling
                        ? false
                        : Boolean(selectedMedia.loop)
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

    function changeExhibitionType(mediaId: string, value: ExhibitionType) {
        setTimelineQueue((current) =>
            current.map((entry) =>
                entry.id === mediaId ? { ...entry, exhibitionType: value } : entry
            )
        );
        if (selectedMedia?.id === mediaId) {
            onSelectMedia({ ...selectedMedia, exhibitionType: value });
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
        ranges: Array<{ inPoint: number; outPoint: number }>
    ) {
        const source = timelineQueue.find((entry) => entry.id === mediaId);
        if (!source) return;
        if (isPlaying && selectedMedia?.id === mediaId) {
            window.alert("Pause ou pare o vídeo antes de editar o item em exibição.");
            return;
        }

        const duration = Math.max(0, source.duration ?? 0);
        const valid = ranges.length >= 1 && ranges.length <= 6 &&
            ranges.every((range, index) =>
                Number.isFinite(range.inPoint) &&
                Number.isFinite(range.outPoint) &&
                range.inPoint >= 0 &&
                range.outPoint > range.inPoint &&
                range.outPoint <= duration + 0.01 &&
                (index === 0 || range.inPoint >= ranges[index - 1].outPoint)
            );

        if (!valid) {
            window.alert("Defina de 1 a 6 blocos válidos, em ordem, sem sobreposição.");
            return;
        }

        const sourceMediaId = source.sourceMediaId ?? source.id;
        const stamp = Date.now();
        const blocks: MediaItem[] = ranges.map((range, index) => ({
            ...source,
            id: `${sourceMediaId}-block-${stamp}-${index + 1}`,
            sourceMediaId,
            inPoint: range.inPoint,
            outPoint: range.outPoint,
            blockLabel: `Bloco ${index + 1}`,
            loop: false,
            freezeEnd:
                Boolean(source.freezeEnd) &&
                index === ranges.length - 1
        }));

        setTimelineQueue((current) => {
            const index = current.findIndex((item) => item.id === mediaId);
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
                            {testBench && !ndiTestMode && isPlaying
                                ? "● PRÉVIA DE TESTE (SEM NDI)"
                                : nativePlayout.state === "PLAYING" &&
                                  ndiOnline &&
                                  nativePlaybackActive
                                  ? "● MOTOR SANTTOS · NDI ATIVO"
                                : nativePlayout.state === "PAUSED"
                                  ? "● MOTOR SANTTOS · PAUSADO"
                                : nativePlayout.state === "FAULT"
                                  ? "● FALHA NO MOTOR SANTTOS"
                                : isPlaying
                                  ? "● SEM SINAL DE PROGRAMA"
                                  : playoutError
                                    ? "● FALHA NO PLAYOUT"
                                    : "● OFF AIR"}
                        </span>
                    </div>

                    <div className="program-media-row">
                        <div className="program-monitor">
                        {selectedMediaUrl ? (
                            <>
                                <video
                                    id="program-video"
                                    ref={videoRef}
                                    className="program-video"
                                    src={selectedMediaUrl}
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
                                        setPreviewError("");
                                    }}
                                    onError={(event) => {
                                        const code = event.currentTarget.error?.code;
                                        const problem = code === 4
                                            ? "Formato ou codec não suportado pelo monitor Chromium."
                                            : code === 3
                                              ? "O monitor não conseguiu decodificar este vídeo."
                                              : "Falha ao ler a mídia. Confirme que o arquivo ou servidor de arquivos está disponível.";
                                        setPreviewError(
                                            `${problem} Se o arquivo toca no FFmpeg, prepare uma prévia MP4 compatível.`
                                        );
                                    }}
                                    onDurationChange={() =>
                                        setDuration(
                                            getClipDuration(selectedMedia)
                                        )
                                    }
                                    onEnded={() => {
                                        if (!nativeOutputEnabled && selectedMedia) {
                                            if (selectedMedia.freezeEnd) {
                                                clipAdvanceGuardRef.current = true;
                                                holdLastFrame(selectedMedia);
                                            } else {
                                                void playNextMedia("completed");
                                            }
                                        }
                                    }}
                                />

                                {previewError && (
                                    <div className="program-preview-error" role="alert">
                                        <strong>PRÉVIA NÃO DISPONÍVEL</strong>
                                        <span>{previewError}</span>
                                        <button
                                            type="button"
                                            disabled={previewPreparing || (isPlaying && !testBench)}
                                            onClick={() => void prepareBrowserPreview()}
                                        >
                                            {previewPreparing ? "Preparando prévia com FFmpeg…" : "Preparar prévia MP4 compatível"}
                                        </button>
                                        <small>
                                            A conversão pode demorar conforme o filme.
                                            A saída NDI continua usando o arquivo original.
                                        </small>
                                    </div>
                                )}

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

                                {selectedMedia && exhibitionText(selectedMedia.exhibitionType, exhibitionStyle) && (
                                    <div
                                        className="program-exhibition-overlay"
                                        aria-label="Identificação editorial no vídeo"
                                        style={exhibitionPreviewStyle(watermarkStyle, exhibitionStyle)}
                                    >
                                        {exhibitionText(selectedMedia.exhibitionType, exhibitionStyle)}
                                    </div>
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
                        ) : selectedMedia?.sourceType === "input" ? (
                            <div className="program-live-input-preview">
                                <strong>INPUT AO VIVO</strong>
                                <span>{selectedMedia.name}</span>
                                <small>
                                    {selectedMedia.inputProtocol?.toUpperCase() ?? "STREAM"}
                                    {" · "}
                                    saída monitorada pelo PROGRAM / NDI
                                </small>
                            </div>
                        ) : (
                            "SEM SINAL"
                        )}
                        </div>
                        <ProgramAudioMeters
                            videoRef={videoRef}
                            mediaUrl={selectedMediaUrl}
                            isPlaying={isPlaying}
                            nativeOutput={nativeOutputEnabled}
                            audio={audioStatus}
                        />
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
                            onClick={() =>
                                playNextMedia(
                                    selectedMedia &&
                                    freezeHoldItemId === selectedMedia.id
                                        ? "completed"
                                        : "skipped"
                                )
                            }
                            disabled={!nextMedia}
                        >⏭</button>

                        {selectedMedia &&
                         selectedMedia.sourceType !== "input" &&
                         !previewProxyBySource[selectedMedia.path] &&
                         !previewError && (
                            <button
                                className="program-proxy-action"
                                title="Gerar prévia MP4 leve para formatos não suportados pelo Chromium"
                                disabled={previewPreparing || (isPlaying && !testBench)}
                                onClick={() => void prepareBrowserPreview()}
                            >
                                {previewPreparing ? "Preparando…" : "Prévia MP4"}
                            </button>
                        )}
                        {selectedMedia && previewProxyBySource[selectedMedia.path] && (
                            <span className="program-proxy-ready">Prévia compatível</span>
                        )}

                        <div
                            className="program-time"
                            title="Tempo restante do vídeo atual"
                        >
                            RESTANTE{" "}
                            {formatDuration(
                                Math.max(
                                    0,
                                    selectedClipDuration -
                                        selectedClipCurrent
                                )
                            )}
                        </div>
                    </div>

                    <div className="program-progress-shell">
                        <input
                            className="program-progress-slider"
                            type="range"
                            min={0}
                            max={Math.max(0.1, selectedClipDuration)}
                            step={0.1}
                            value={Math.min(
                                selectedClipDuration,
                                Math.max(
                                    0,
                                    pendingSeek ?? selectedClipCurrent
                                )
                            )}
                            disabled={
                                !selectedMedia ||
                                selectedMedia.sourceType === "input" ||
                                selectedClipDuration <= 0
                            }
                            aria-label="Posição do PROGRAM"
                            onChange={(event) => {
                                const relative = Number(event.currentTarget.value);
                                setPendingSeek(relative);
                                const video = videoRef.current;
                                if (video && selectedMedia) {
                                    video.currentTime =
                                        getClipIn(selectedMedia) + relative;
                                }
                            }}
                            onPointerUp={(event) =>
                                void seekProgram(
                                    Number(event.currentTarget.value)
                                )
                            }
                            onKeyUp={(event) =>
                                void seekProgram(
                                    Number(event.currentTarget.value)
                                )
                            }
                        />
                        <div className="program-progress-readout">
                            <span
                                style={{
                                    width: `${progressPercent}%`
                                }}
                            />
                        </div>
                    </div>
                </section>

                <div className="playout-status-row">
                    <section className="panel compact-status-card">
                        <div className="panel-title">NO AR</div>
                        <strong title={selectedMedia?.name ?? "Nenhum conteúdo"}>
                            {selectedMedia?.name ?? "Nenhum conteúdo"}
                        </strong>
                        {selectedMedia && (
                            <span className="compact-status-meta">
                                {normalizeExhibitionType(selectedMedia.exhibitionType) !== "NORMAL"
                                    ? exhibitionLabel(selectedMedia.exhibitionType)
                                    : ""}
                                {selectedMedia.hashtag
                                    ? (normalizeExhibitionType(selectedMedia.exhibitionType) !== "NORMAL" ? " · " : "") +
                                      "GC: " + selectedMedia.hashtag
                                    : ""}
                            </span>
                        )}
                    </section>
                    <section className="panel compact-status-card">
                        <div className="panel-title">PRÓXIMO</div>
                        <strong title={nextMedia?.name ?? "Nenhum conteúdo"}>
                            {nextMedia?.name ?? "Nenhum conteúdo"}
                        </strong>
                        {nextMedia && (
                            <>
                                <span className="compact-status-meta">
                                    {normalizeExhibitionType(nextMedia.exhibitionType) !== "NORMAL"
                                        ? exhibitionLabel(nextMedia.exhibitionType)
                                        : ""}
                                    {nextMedia.hashtag
                                        ? (normalizeExhibitionType(nextMedia.exhibitionType) !== "NORMAL" ? " · " : "") +
                                          "GC: " + nextMedia.hashtag
                                        : ""}
                                </span>
                                <span className="next-entry-forecast">{describeForecast(nextMedia)}</span>
                            </>
                        )}
                    </section>
                    <section className="panel compact-status-card operation-status-card">
                        <div className="panel-title">OPERAÇÃO</div>
                        <strong>
                            {nativePlayout.state === "PAUSED"
                                ? "PROGRAM PAUSADO"
                                : ndiOnline
                                  ? "SAÍDA ESTÁVEL"
                                  : "VERIFICAR SAÍDA"}
                        </strong>
                        <span className="compact-status-meta">
                            {selectedMedia?.sourceType === "input"
                                ? "INPUT EXTERNO"
                                : selectedMedia?.path.startsWith("\\\\")
                                  ? "SERVIDOR DE ARQUIVOS"
                                  : "ARQUIVO LOCAL"}
                            {" · "}
                            Programado:{" "}
                            {selectedMedia
                                ? plannedSchedule.times.get(selectedMedia.id) ?? "--:--:--"
                                : "--:--:--"}
                            {" · "}
                            Próximo:{" "}
                            {nextMedia
                                ? plannedSchedule.times.get(nextMedia.id) ?? "--:--:--"
                                : "--:--:--"}
                        </span>
                        <span className="next-entry-forecast">
                            {nextMedia
                                ? describeForecast(nextMedia)
                                : "Fim da programação"}
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
                        const hasTimelineItem =
                            event.dataTransfer.types.includes(
                                "application/x-santtos-timeline-item"
                            );

                        if (
                            hasFiles ||
                            hasLibraryMedia ||
                            hasTimelineItem
                        ) {
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

                        const draggedItem =
                            parseDraggedTimelineItem(
                                event.dataTransfer.getData(
                                    "application/x-santtos-timeline-item"
                                )
                            );

                        if (draggedItem) {
                            event.preventDefault();
                            event.stopPropagation();
                            addTimelineItem(
                                draggedItem
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
                                                const hasTimelineItem =
                                                    event.dataTransfer.types.includes(
                                                        "application/x-santtos-timeline-item"
                                                    );
                                                const hasFiles =
                                                    event.dataTransfer.types.includes("Files");

                                                if (
                                                    hasFiles ||
                                                    isLibraryMedia ||
                                                    hasTimelineItem ||
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

                                                const draggedItem =
                                                    parseDraggedTimelineItem(
                                                        event.dataTransfer.getData(
                                                            "application/x-santtos-timeline-item"
                                                        )
                                                    );

                                                if (draggedItem) {
                                                    addTimelineItem(
                                                        draggedItem,
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
                                                    ? forecastRunning ? "NO AR" : isPlaying ? "AGUARDANDO" : "PRONTO"
                                                    : `${index + 1}`}
                                            </div>

                                            <div className="timeline-content">
                                                <strong>
                                                    {item.blockLabel
                                                        ? `${item.name} — ${item.blockLabel}`
                                                        : item.name}
                                                </strong>

                                                <div className="timeline-meta-row">
                                                    <span className="timeline-clip-time">
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
                                                        PROGRAMADO{" "}
                                                        {plannedSchedule.times.get(
                                                            item.id
                                                        ) ?? "SEM PREVISÃO"}
                                                        {" • "}
                                                        {describeForecast(
                                                            item,
                                                            isCurrent
                                                        )}
                                                    </span>
                                                </div>
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

                                                    <div className="timeline-exhibition">
                                                        <select
                                                            id={`exhibition-${item.id}`}
                                                            aria-label="Modo de exibição"
                                                            title="Modo de exibição"
                                                            value={normalizeExhibitionType(item.exhibitionType)}
                                                            onChange={(event) =>
                                                                changeExhibitionType(
                                                                    item.id,
                                                                    event.currentTarget.value as ExhibitionType
                                                                )
                                                            }
                                                        >
                                                            {EXHIBITION_OPTIONS.map((option) => (
                                                                <option key={option.value} value={option.value}>
                                                                    {option.label}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>

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
                                                    <button
                                                        className={
                                                            item.freezeEnd
                                                                ? "timeline-freeze-button active"
                                                                : "timeline-freeze-button"
                                                        }
                                                        title="Congelar o último frame ao final"
                                                        onClick={() =>
                                                            toggleTimelineFreeze(
                                                                item.id
                                                            )
                                                        }
                                                    >FRZ</button>
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
    onSaveEdit: (mediaId: string, inPoint: number, outPoint: number) => void;
    onSplit: (
        mediaId: string,
        ranges: Array<{ inPoint: number; outPoint: number }>
    ) => void;
}

type BlockRangeText = {
    inText: string;
    outText: string;
    durationText: string;
};

function distributeParts(inPoint: number, outPoint: number, partCount: number): BlockRangeText[] {
    const duration = Math.max(0, outPoint - inPoint);
    return Array.from({ length: partCount }, (_, index) => {
        const start = inPoint + (duration * index) / partCount;
        const end = inPoint + (duration * (index + 1)) / partCount;
        return {
            inText: formatEditorTime(start),
            outText: formatEditorTime(end),
            durationText: formatEditorTime(end - start)
        };
    });
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
    const [inText, setInText] = useState(formatEditorTime(initialIn));
    const [outText, setOutText] = useState(formatEditorTime(initialOut));
    const [partCount, setPartCount] = useState(3);
    const [parts, setParts] = useState<BlockRangeText[]>(() =>
        distributeParts(initialIn, initialOut, 3)
    );

    const parsedIn = parseEditorTime(inText);
    const parsedOut = parseEditorTime(outText);
    const validEdit =
        parsedIn !== null && parsedOut !== null &&
        parsedIn >= 0 && parsedOut > parsedIn &&
        parsedOut <= duration + 0.01;

    const ranges = parts.map((part) => ({
        inPoint: parseEditorTime(part.inText),
        outPoint: parseEditorTime(part.outText)
    }));
    const validSplit = validEdit &&
        ranges.length === partCount &&
        ranges.every((range, index) =>
            range.inPoint !== null && range.outPoint !== null &&
            range.inPoint >= parsedIn! && range.outPoint <= parsedOut! &&
            range.outPoint > range.inPoint &&
            (index === 0 || (
                ranges[index - 1].outPoint !== null &&
                range.inPoint >= ranges[index - 1].outPoint!
            ))
        );

    function redistribute(count = partCount) {
        setParts(distributeParts(parsedIn ?? initialIn, parsedOut ?? initialOut, count));
    }

    function partDuration(part: BlockRangeText) {
        const start = parseEditorTime(part.inText);
        const end = parseEditorTime(part.outText);
        if (start !== null && end !== null && end > start) {
            return end - start;
        }
        const entered = parseEditorTime(part.durationText);
        return entered !== null && entered > 0 ? entered : 0;
    }

    function compensateFollowingBlocks(
        updated: BlockRangeText[],
        changedIndex: number,
        changedEnd: number,
        overallEnd: number
    ) {
        const following = updated.slice(changedIndex + 1);
        if (following.length === 0) return;

        const available = Math.floor(overallEnd) - Math.floor(changedEnd);
        if (available <= 0) return;

        const weights = following.map((part) => Math.max(1, partDuration(part)));
        const totalWeight = weights.reduce((sum, value) => sum + value, 0);
        let cursor = Math.floor(changedEnd);
        let remainingSeconds = available;
        let remainingWeight = totalWeight;

        following.forEach((part, offset) => {
            const position = changedIndex + 1 + offset;
            const isLast = offset === following.length - 1;
            const weight = weights[offset];

            const seconds = isLast
                ? remainingSeconds
                : Math.max(
                      1,
                      Math.round(
                          remainingSeconds * (weight / Math.max(1, remainingWeight))
                      )
                  );

            const safeSeconds = Math.min(
                seconds,
                Math.max(1, remainingSeconds - (following.length - offset - 1))
            );
            const end = isLast
                ? Math.floor(overallEnd)
                : cursor + safeSeconds;

            updated[position] = {
                ...part,
                inText: formatEditorTime(cursor),
                outText: formatEditorTime(end),
                durationText: formatEditorTime(end - cursor)
            };

            remainingSeconds -= end - cursor;
            remainingWeight -= weight;
            cursor = end;
        });
    }

    function compensateLastBlock(
        updated: BlockRangeText[],
        index: number,
        customDuration: number,
        overallStart: number,
        overallEnd: number
    ) {
        if (index !== updated.length - 1) return false;

        const end = Math.floor(overallEnd);
        const start = end - Math.floor(customDuration);
        if (start < Math.floor(overallStart)) return false;

        const selected = updated[index];
        updated[index] = {
            ...selected,
            inText: formatEditorTime(start),
            outText: formatEditorTime(end),
            durationText: formatEditorTime(end - start)
        };

        // O último bloco também precisa caber. Se ele crescer ou encolher,
        // o bloco anterior absorve a diferença para manter o FINAL GERAL.
        if (index > 0) {
            const previous = updated[index - 1];
            const previousStart = parseEditorTime(previous.inText);
            if (previousStart !== null && start > previousStart) {
                updated[index - 1] = {
                    ...previous,
                    outText: formatEditorTime(start),
                    durationText: formatEditorTime(start - previousStart)
                };
            }
        }
        return true;
    }

    function updatePart(index: number, field: keyof BlockRangeText, value: string) {
        setParts((current) => {
            const updated = current.map((part) => ({ ...part }));
            const selected = updated[index];
            if (!selected) return current;

            selected[field] = value;

            const overallStart = parsedIn ?? initialIn;
            const overallEnd = parsedOut ?? initialOut;

            if (field === "inText") {
                const start = parseEditorTime(value);
                const end = parseEditorTime(selected.outText);

                // IN e OUT são as referências. Ao alterar IN, DURAÇÃO
                // precisa refletir imediatamente o novo intervalo.
                if (start !== null && end !== null && end > start) {
                    selected.durationText = formatEditorTime(end - start);
                }
                return updated;
            }

            if (field === "outText") {
                const start = parseEditorTime(selected.inText);
                const end = parseEditorTime(value);

                if (start !== null && end !== null && end > start) {
                    selected.durationText = formatEditorTime(end - start);

                    // A alteração de OUT consome ou devolve tempo. Os blocos
                    // posteriores compensam automaticamente até FINAL GERAL.
                    if (end <= overallEnd) {
                        compensateFollowingBlocks(
                            updated,
                            index,
                            end,
                            overallEnd
                        );
                    }
                }
                return updated;
            }

            const start = parseEditorTime(selected.inText);
            const customDuration = parseEditorTime(value);
            if (
                start === null ||
                customDuration === null ||
                customDuration <= 0
            ) {
                return updated;
            }

            // No último bloco a compensação acontece para trás, mantendo
            // exatamente o FINAL GERAL definido pelo operador.
            if (
                compensateLastBlock(
                    updated,
                    index,
                    customDuration,
                    overallStart,
                    overallEnd
                )
            ) {
                return updated;
            }

            const end = start + customDuration;
            selected.outText = formatEditorTime(end);
            selected.durationText = value;

            // Ex.: um bloco passa para 10 s. O tempo que sobrar até
            // FINAL GERAL é redistribuído proporcionalmente nos próximos,
            // mantendo toda a sequência encaixada e funcional.
            if (end <= overallEnd) {
                compensateFollowingBlocks(
                    updated,
                    index,
                    end,
                    overallEnd
                );
            }

            return updated;
        });
    }

    return (
        <div
            className="film-editor-backdrop"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
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
                    <small>O arquivo original não será alterado. Cada bloco guarda apenas IN e OUT.</small>
                </div>

                <div className="film-editor-grid">
                    <TimecodeField label="INÍCIO GERAL" value={inText} onChange={setInText} />
                    <TimecodeField label="FINAL GERAL" value={outText} onChange={setOutText} />
                </div>

                <div className="film-editor-count">
                    <label htmlFor="block-count">Quantidade de blocos
                        <select
                            id="block-count"
                            value={partCount}
                            onChange={(event) => {
                                const count = Number(event.currentTarget.value);
                                setPartCount(count);
                                redistribute(count);
                            }}
                        >
                            {[1, 2, 3, 4, 5, 6].map((count) => (
                                <option value={count} key={count}>
                                    {count} {count === 1 ? "bloco" : "blocos"}{count === 3 ? " (padrão)" : ""}
                                </option>
                            ))}
                        </select>
                    </label>
                    <button type="button" onClick={() => redistribute()}>
                        Distribuir igualmente
                    </button>
                    <span>IN, OUT e DURAÇÃO trabalham juntos. Ao alterar um tempo, a duração é atualizada e o restante dos blocos compensa automaticamente para continuar encaixado no FINAL GERAL.</span>
                </div>

                <div className="film-editor-block-list">
                    {parts.map((part, index) => (
                        <div className="film-editor-block-row" key={index}>
                            <strong>Bloco {index + 1}</strong>
                            <TimecodeField
                                label="IN"
                                value={part.inText}
                                onChange={(value) => updatePart(index, "inText", value)}
                            />
                            <TimecodeField
                                label="OUT"
                                value={part.outText}
                                onChange={(value) => updatePart(index, "outText", value)}
                            />
                            <TimecodeField
                                label="DURAÇÃO"
                                value={part.durationText}
                                onChange={(value) => updatePart(index, "durationText", value)}
                            />
                            <small>{formatRange(ranges[index].inPoint, ranges[index].outPoint)}</small>
                        </div>
                    ))}
                </div>

                {!validEdit && (
                    <div className="film-editor-error">
                        IN/OUT gerais inválidos. Use mm:ss ou hh:mm:ss, dentro da duração do filme.
                    </div>
                )}
                {validEdit && !validSplit && (
                    <div className="film-editor-error">
                        Revise os blocos: cada IN deve ser menor que OUT, sem sobreposição e dentro do intervalo geral.
                    </div>
                )}

                <footer className="film-editor-footer">
                    <button onClick={onClose}>Cancelar</button>
                    <button
                        disabled={!validEdit}
                        onClick={() => validEdit && onSaveEdit(item.id, parsedIn!, parsedOut!)}
                    >
                        Salvar somente edição
                    </button>
                    <button
                        className="primary-button"
                        disabled={!validSplit}
                        onClick={() => validSplit && onSplit(
                            item.id,
                            ranges.map((range) => ({
                                inPoint: range.inPoint!,
                                outPoint: range.outPoint!
                            }))
                        )}
                    >
                        Criar {partCount} {partCount === 1 ? "bloco" : "blocos"}
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
    const [libraryMode, setLibraryMode] =
        useState<"media" | "inputs">("media");

    async function loadCategories(preferredId?: string) {
        try {
            const loaded = await window.santtosAPI.getLibraryCategories();
            setCategories(loaded);
            const validIds = new Set([
                "__all__",
                ...loaded.map((item) => item.id)
            ]);
            const nextId =
                preferredId && validIds.has(preferredId)
                    ? preferredId
                    : validIds.has(activeCategoryId)
                      ? activeCategoryId
                      : "__all__";
            setActiveCategoryId(nextId);
            return { loaded, nextId };
        } catch (error) {
            console.error(error);
            setCategoryStatus("Não foi possível carregar as abas da Biblioteca.");
            return null;
        }
    }

    useEffect(() => {
        void loadCategories();
    }, []);

    useEffect(() => {
        const handleCategoriesUpdated = () => {
            void (async () => {
                const synced = await loadCategories(activeCategoryId);
                const categoryId = synced?.nextId;
                if (!categoryId) return;

                if (categoryId === "__all__") {
                    const results = await Promise.all(
                        (synced?.loaded ?? []).map((category) =>
                            window.santtosAPI.scanLibraryCategory(category.id)
                        )
                    );
                    const paths = [
                        ...new Set(
                            results.flatMap((result) =>
                                result.ok
                                    ? result.filePaths ?? []
                                    : []
                            )
                        )
                    ];
                    if (paths.length > 0) {
                        await onImportDroppedFiles(paths);
                    }
                    setCategoryStatus(
                        `${paths.length} arquivo(s) sincronizado(s) em ${synced?.loaded.length ?? 0} pasta(s).`
                    );
                    return;
                }

                const result = await window.santtosAPI.scanLibraryCategory(categoryId);
                if (!result.ok) {
                    setCategoryStatus(result.error ?? "Não foi possível atualizar esta pasta.");
                    return;
                }

                if (result.category) {
                    setCategories((current) =>
                        current.map((item) =>
                            item.id === result.category!.id
                                ? result.category!
                                : item
                        )
                    );
                }

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

                const categoryName =
                    result.category?.name ??
                    synced?.loaded.find((item) => item.id === categoryId)?.name ??
                    "Biblioteca";
                setCategoryStatus(`${paths.length} arquivo(s) encontrado(s) em ${categoryName}.`);
            })().catch((error) => {
                console.error(error);
                setCategoryStatus("Não foi possível sincronizar a Biblioteca.");
            });
        };

        window.addEventListener(
            "santtos:library-categories-updated",
            handleCategoriesUpdated
        );

        return () =>
            window.removeEventListener(
                "santtos:library-categories-updated",
                handleCategoriesUpdated
            );
    }, [activeCategoryId]);

    const allCategory: LibraryCategory = {
        id: "__all__",
        name: "Todas",
        folderPath: "",
        builtIn: true
    };
    const activeCategory =
        activeCategoryId === allCategory.id
            ? allCategory
            : categories.find(
                  (item) => item.id === activeCategoryId
              ) ?? null;

    function belongsToFolder(filePath: string, folderPath: string) {
        if (!folderPath) return false;
        const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
        const file = normalize(filePath);
        const folder = normalize(folderPath);
        return file.startsWith(`${folder}/`) && !file.slice(folder.length + 1).includes("/");
    }

    const configuredFolders = useMemo(
        () =>
            categories.filter(
                (category) => Boolean(category.folderPath)
            ),
        [categories]
    );

    const libraryMedia = useMemo(
        () =>
            media.filter((item) =>
                configuredFolders.some((category) =>
                    belongsToFolder(
                        item.path,
                        category.folderPath
                    )
                )
            ),
        [media, configuredFolders]
    );

    const categoryMedia = useMemo(() => {
        if (activeCategoryId === "__all__") {
            return libraryMedia;
        }
        if (!activeCategory?.folderPath) return [];
        return media.filter((item) =>
            belongsToFolder(
                item.path,
                activeCategory.folderPath
            )
        );
    }, [
        media,
        libraryMedia,
        activeCategoryId,
        activeCategory?.folderPath
    ]);

    const filteredMedia = useMemo(() => {
        const normalized = search
            .trim()
            .toLowerCase();

        // A pesquisa é sempre global, independentemente da pasta aberta.
        const source = normalized
            ? libraryMedia
            : categoryMedia;

        if (!normalized) return source;

        return source.filter((item) => {
            const categoryName =
                configuredFolders.find((category) =>
                    belongsToFolder(
                        item.path,
                        category.folderPath
                    )
                )?.name ?? "";
            return (
                item.name
                    .toLowerCase()
                    .includes(normalized) ||
                item.path
                    .toLowerCase()
                    .includes(normalized) ||
                categoryName
                    .toLowerCase()
                    .includes(normalized)
            );
        });
    }, [
        categoryMedia,
        libraryMedia,
        configuredFolders,
        search
    ]);

    async function refreshCategory() {
        if (!activeCategory) return;
        setIsRefreshing(true);
        setCategoryStatus("");
        try {
            if (activeCategoryId === "__all__") {
                const results = await Promise.all(
                    categories.map((category) =>
                        window.santtosAPI
                            .scanLibraryCategory(
                                category.id
                            )
                    )
                );
                const paths = [
                    ...new Set(
                        results.flatMap(
                            (result) =>
                                result.ok
                                    ? result.filePaths ?? []
                                    : []
                        )
                    )
                ];
                if (paths.length > 0) {
                    await onImportDroppedFiles(paths);
                }
                setCategoryStatus(
                    `${paths.length} arquivo(s) encontrado(s) em ${categories.length} pasta(s).`
                );
                return;
            }

            const result = await window.santtosAPI.scanLibraryCategory(activeCategory.id);
            if (!result.ok) throw new Error(result.error ?? "Falha ao atualizar");

            // A configuração pode ter sido alterada enquanto o Playout ficou
            // montado em segundo plano. O backend é a fonte de verdade.
            const refreshedCategory = result.category ?? activeCategory;
            if (result.category) {
                setCategories((current) =>
                    current.map((item) =>
                        item.id === result.category!.id
                            ? result.category!
                            : item
                    )
                );
            }

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
            setCategoryStatus(`${paths.length} arquivo(s) encontrado(s) em ${refreshedCategory.name}.`);
        } catch (error) {
            console.error(error);
            setCategoryStatus("Não foi possível atualizar esta pasta.");
        } finally {
            setIsRefreshing(false);
        }
    }

    function folderNameFromPath(folderPath: string) {
        const normalized = folderPath
            .replace(/[\\/]+$/, "")
            .replace(/\\/g, "/");
        const segments = normalized
            .split("/")
            .filter(Boolean);
        return (
            segments[segments.length - 1] ??
            "Nova pasta"
        ).slice(0, 40);
    }

    async function createCategory() {
        setCategoryStatus(
            "Selecione a pasta que deseja adicionar à Biblioteca..."
        );

        try {
            const folderResult =
                await window.santtosAPI.selectLibraryFolder();

            if (
                !folderResult.ok ||
                !folderResult.folderPath
            ) {
                setCategoryStatus(
                    folderResult.canceled
                        ? "Criação cancelada: nenhuma pasta foi selecionada."
                        : "Não foi possível selecionar a nova pasta."
                );
                return;
            }

            const duplicate =
                categories.find(
                    (category) =>
                        category.folderPath
                            .replace(/\\/g, "/")
                            .replace(/\/+$/, "")
                            .toLowerCase() ===
                        folderResult.folderPath!
                            .replace(/\\/g, "/")
                            .replace(/\/+$/, "")
                            .toLowerCase()
                );

            if (duplicate) {
                setLibraryMode("media");
                setActiveCategoryId(duplicate.id);
                setCategoryStatus(
                    `A pasta já está cadastrada como "${duplicate.name}".`
                );
                return;
            }

            const created: LibraryCategory = {
                id:
                    `custom-${Date.now()}-${Math.random()
                        .toString(16)
                        .slice(2)}`,
                name:
                    folderNameFromPath(
                        folderResult.folderPath
                    ),
                folderPath:
                    folderResult.folderPath,
                builtIn: false
            };

            const result =
                await window.santtosAPI
                    .saveLibraryCategories([
                        ...categories,
                        created
                    ]);

            if (!result.ok) {
                setCategoryStatus(
                    result.error ??
                        "Não foi possível adicionar a pasta."
                );
                return;
            }

            const saved =
                result.categories ??
                [...categories, created];

            setCategories(saved);
            setLibraryMode("media");
            setActiveCategoryId(created.id);
            setSearch("");

            const scanResult =
                await window.santtosAPI
                    .scanLibraryCategory(
                        created.id
                    );

            if (!scanResult.ok) {
                setCategoryStatus(
                    scanResult.error ??
                        `Pasta ${created.name} adicionada, mas não foi possível ler os arquivos.`
                );
                return;
            }

            const paths =
                scanResult.filePaths ?? [];

            if (paths.length > 0) {
                await onImportDroppedFiles(
                    paths
                );
            }

            setCategoryStatus(
                `Pasta ${created.name} adicionada. ${paths.length} arquivo(s) encontrado(s).`
            );
        } catch (error) {
            console.error(error);
            setCategoryStatus(
                "Não foi possível adicionar a nova pasta à Biblioteca."
            );
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
                <div className="library-module-heading">
                    <div className="library-module-switch">
                        <button
                            type="button"
                            className={
                                libraryMode === "media"
                                    ? "active"
                                    : ""
                            }
                            onClick={() => {
                                setLibraryMode("media");
                                setCategoryStatus("");
                            }}
                        >
                            BIBLIOTECA
                        </button>
                        <button
                            type="button"
                            className={
                                libraryMode === "inputs"
                                    ? "active premium"
                                    : "premium"
                            }
                            onClick={() => {
                                setLibraryMode("inputs");
                                setCategoryStatus("");
                            }}
                        >
                            INPUT WEB
                        </button>
                    </div>
                    <h1>
                        {libraryMode === "inputs"
                            ? "Inputs ao vivo"
                            : activeCategory?.name ?? "Biblioteca de mídia"}
                    </h1>
                </div>
                {libraryMode === "media" && (
                    <button
                        className="library-refresh-button"
                        onClick={refreshCategory}
                        disabled={isRefreshing || !activeCategory}
                    >
                        {isRefreshing ? "Atualizando..." : "↻ Atualizar"}
                    </button>
                )}
            </div>

            {libraryMode === "media" && (
                <div className="library-category-tabs">
                    <button
                        type="button"
                        className={
                            activeCategoryId === "__all__"
                                ? "active"
                                : ""
                        }
                        onClick={() => {
                            setActiveCategoryId("__all__");
                            setCategoryStatus("");
                        }}
                    >
                        Todas
                    </button>
                    {categories.map((category) => (
                        <button
                            key={category.id}
                            type="button"
                            className={category.id === activeCategoryId ? "active" : ""}
                            onClick={() => {
                                setActiveCategoryId(category.id);
                                setCategoryStatus("");
                            }}
                        >
                            {category.name}
                        </button>
                    ))}
                    <button
                        type="button"
                        className="library-new-tab"
                        onClick={() => void createCategory()}
                    >
                        + Nova pasta
                    </button>
                </div>
            )}

            {libraryMode === "inputs" ? (
                <WebInputsPanel
                    onAddToTimeline={onAddToTimeline}
                />
            ) : (
                <>
                <div className="library-category-status">
                    <strong>
                        {activeCategoryId === "__all__"
                            ? "Pastas:"
                            : activeCategory?.folderPath
                              ? "Pasta:"
                              : "Sem pasta configurada"}
                    </strong>
                    {activeCategoryId === "__all__" ? (
                        <span>
                            {configuredFolders.length} pasta(s)
                            configurada(s) · pesquisa global
                        </span>
                    ) : (
                        activeCategory?.folderPath && (
                            <span title={activeCategory.folderPath}>
                                {activeCategory.folderPath}
                            </span>
                        )
                    )}
                </div>
    
                <div className="library-toolbar">
                    <input
                        className="search-input"
                        type="search"
                        value={search}
                        placeholder="Pesquisar em toda a Biblioteca..."
                        onChange={(event) => setSearch(event.target.value)}
                    />
                    <span>{filteredMedia.length} arquivo(s)</span>
                </div>
    
                {(categoryStatus || message) && (
                    <div className="library-message">{categoryStatus || message}</div>
                )}
    
                {activeCategoryId !== "__all__" &&
                !activeCategory?.folderPath ? (
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
                </>
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
