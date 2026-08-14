import {
    useEffect,
    useMemo,
    useRef,
    useState
} from "react";

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
    thumbnail: string | null;

    status: string;
    createdAt: string;
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
}

declare global {
    interface Window {
        santtosAPI: {
            selectVideos: () =>
                Promise<string[]>;

            getMedia: () =>
                Promise<MediaItem[]>;

            importMedia: (
                filePaths: string[]
            ) => Promise<ImportResult>;

            removeMedia: (
                mediaId: string
            ) => Promise<RemoveResult>;

            getNdiStatus: () =>
    Promise<{
        online: boolean;
        source: string;
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

   useEffect(() => {
       
    const updateClock = () => {
        setClock(
            new Date().toLocaleTimeString(
                "pt-BR"
            )
        );
    };

    updateClock();

    const timer =
        window.setInterval(
            updateClock,
            1000
        );

    return () =>
        window.clearInterval(
            timer
        );
}, []);

useEffect(() => {
    const updateNdiStatus =
        async () => {
            try {
                const status =
                    await window.santtosAPI
                        .getNdiStatus();

                setNdiOnline(
                    status.online
                );
            } catch (error) {
                console.error(
                    "Erro ao consultar NDI:",
                    error
                );

                setNdiOnline(false);
            }
        };

    updateNdiStatus();

    const timer =
        window.setInterval(
            updateNdiStatus,
            1000
        );

    return () =>
        window.clearInterval(
            timer
        );
}, []);


    async function loadMedia() {
        try {
            const savedMedia =
                await window.santtosAPI.getMedia();

            setMedia(savedMedia);
        } catch (error) {
            console.error(error);

            setMessage(
                "Não foi possível carregar a biblioteca."
            );
        }
    }

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

           getNdiStatus: () =>
    Promise<{
        online: boolean;
        source: string;
    }>;
            
            const result =
                await window.santtosAPI
                    .importMedia(
                        selectedFiles
                    );

            setMedia(result.media);

            const importedCount =
                result.importedItems.length;

            const duplicatedCount =
                result.duplicatedItems.length;

            if (
                importedCount > 0 &&
                duplicatedCount === 0
            ) {
                setMessage(
                    `${importedCount} vídeo(s) adicionado(s).`
                );
            } else if (
                importedCount > 0 &&
                duplicatedCount > 0
            ) {
                setMessage(
                    `${importedCount} vídeo(s) adicionado(s) e ${duplicatedCount} duplicado(s) ignorado(s).`
                );
            } else if (
                duplicatedCount > 0
            ) {
                setMessage(
                    "Os vídeos selecionados já estavam cadastrados."
                );
            } else {
                setMessage(
                    "Nenhum vídeo compatível foi importado."
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
                    .removeMedia(
                        mediaItem.id
                    );

            setMedia(result.media);

            if (result.removed) {
                setMessage(
                    `"${mediaItem.name}" foi removido da biblioteca.`
                );
            }
        } catch (error) {
            console.error(error);

            setMessage(
                "Não foi possível remover o vídeo."
            );
        }
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
                    setActivePanel={
                        setActivePanel
                    }
                />

                <main className="main-content">
                   {activePanel ===
    "playout" && (
    <PlayoutPanel
        media={media}
        isLoading={isLoading}
        message={message}
        selectedMedia={selectedMedia}
        onSelectMedia={setSelectedMedia}
        onAddVideos={addVideos}
        onRemoveMedia={
            handleRemoveMedia
        }
    />
)}
                            {activePanel ===
                        "playlist" && (
                        <EmptyPanel
                            title="Playlist"
                            message="A programação será montada aqui."
                        />
                    )}

                    {activePanel ===
                        "scheduler" && (
                        <EmptyPanel
                            title="Scheduler"
                            message="A programação por horário será configurada aqui."
                        />
                    )}

                    {activePanel ===
                        "settings" && (
                        <EmptyPanel
                            title="Configurações"
                            message="As configurações técnicas serão exibidas aqui."
                        />
                    )}
                </main>
            </div>

            <footer className="footer">
                <span>
                    Santtos TV Automation
                </span>

                <span>
                    {media.length} mídia(s)
                    cadastrada(s)
                </span>

                <span>
                    Playout v0.3 Alpha
                </span>
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
        {
            panel: "playout",
            icon: "📺",
            label: "Playout"
        },
        {
            panel: "library",
            icon: "📁",
            label: "Biblioteca"
        },
        {
            panel: "playlist",
            icon: "📋",
            label: "Playlist"
        },
        {
            panel: "scheduler",
            icon: "🗓",
            label: "Scheduler"
        },
        {
            panel: "settings",
            icon: "⚙",
            label: "Configurações"
        }
    ];

    return (
        <aside className="sidebar">
            {buttons.map((button) => (
                <button
                    key={button.panel}
                    className={
                        activePanel ===
                        button.panel
                            ? "active"
                            : ""
                    }
                    onClick={() =>
                        setActivePanel(
                            button.panel
                        )
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

    onSelectMedia: (
        media: MediaItem
    ) => void;

    onAddVideos: () =>
        Promise<void>;

    onRemoveMedia: (
        media: MediaItem
    ) => Promise<void>;
}
function PlayoutPanel({
    media,
    isLoading,
    message,
    selectedMedia,
    onSelectMedia,
    onAddVideos,
    onRemoveMedia
}: PlayoutPanelProps) {
    const videoRef =
    useRef<HTMLVideoElement | null>(
        null
    );
    const [currentTime, setCurrentTime] =
    useState(0);

    const [duration, setDuration] =
    useState(0);

    const [timelineQueue, setTimelineQueue] =
    useState<MediaItem[]>(media);

    const [
    draggedMediaId,
    setDraggedMediaId
] = useState<string | null>(null);

    const [
    removedTimelineIds,
    setRemovedTimelineIds
] = useState<Set<string>>(
    () => new Set()
);

useEffect(() => {
    setTimelineQueue((currentQueue) => {
        const availableIds =
            new Set(
                media.map(
                    (item) => item.id
                )
            );

        const remainingItems =
            currentQueue.filter(
                (item) =>
                    availableIds.has(
                        item.sourceMediaId ??
                            item.id
                    )
            );

        const existingIds =
            new Set(
                remainingItems.map(
                    (item) =>
                        item.sourceMediaId ??
                        item.id
                )
            );

        const newItems =
            media.filter(
                (item) =>
                    !existingIds.has(
                        item.id
                    ) &&
                    !removedTimelineIds.has(
                        item.id
                    )
            );

        return [
            ...remainingItems,
            ...newItems
        ];
    });
}, [media, removedTimelineIds]);
    useEffect(() => {
    if (
        !selectedMedia &&
        timelineQueue.length > 0
    ) {
        onSelectMedia(
            timelineQueue[0]
        );
    }
}, [
    timelineQueue,
    selectedMedia,
    onSelectMedia
]);
 const progressPercent =
    duration > 0
        ? Math.min(
              100,
              Math.max(
                  0,
                  (currentTime / duration) *
                      100
              )
          )
        : 0;

const selectedMediaIndex =
    selectedMedia
        ? timelineQueue.findIndex(
              (item) =>
                  item.id ===
                  selectedMedia.id
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
const timelineStartTimes = (() => {
    const startTimes =
        new Map<string, string>();

    let cursor: Date;

    if (selectedMediaIndex >= 0) {
        cursor = new Date(
            Date.now() -
                currentTime * 1000
        );
    } else {
        cursor = new Date();
    }

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
                    ? duration > 0
                        ? duration
                        : item.duration ?? 0
                    : item.duration ?? 0;

            cursor = new Date(
                cursor.getTime() +
                    itemDuration * 1000
            );
        }
    );

    return startTimes;
})();
    
    const selectedMediaUrl =
    selectedMedia
        ? encodeURI(
              `file:///${selectedMedia.path.replace(
                  /\\/g,
                  "/"
              )}`
          )
        : null;

    useEffect(() => {
    const width = 1920;
    const height = 1080;

    const frame =
        new Uint8Array(
            width *
            height *
            4
        );

    for (
        let index = 0;
        index < frame.length;
        index += 4
    ) {
        /*
            BGRA:
            azul = 255
            verde = 0
            vermelho = 0
            alpha = 255
        */
        frame[index] = 255;
        frame[index + 1] = 0;
        frame[index + 2] = 0;
        frame[index + 3] = 255;
    }

    const timer =
        window.setTimeout(
            () => {
                window.santtosAPI
                    .sendNdiFrame(
                        frame
                    );
            },
            2000
        );

    return () =>
        window.clearTimeout(
            timer
        );
}, []);
    
    useEffect(() => {
    const video =
        videoRef.current;

    if (!video || !selectedMediaUrl) {
        return;
    }

    video.pause();
    video.currentTime = 0;
    video.load();

    setCurrentTime(0);
}, [selectedMediaUrl]);

    useEffect(() => {
    const video =
        videoRef.current;

    if (!video) {
        return;
    }

    const canvas =
        document.createElement(
            "canvas"
        );

    canvas.width = 1920;
    canvas.height = 1080;

    const context =
        canvas.getContext(
            "2d",
            {
                willReadFrequently:
                    true
            }
        );

    if (!context) {
        return;
    }

    const sendFrame = () => {
        if (
            video.readyState < 2 ||
            video.videoWidth === 0 ||
            video.videoHeight === 0
        ) {
            return;
        }

        context.fillStyle =
            "#000000";

        context.fillRect(
            0,
            0,
            1920,
            1080
        );

        const sourceAspect =
            video.videoWidth /
            video.videoHeight;

        const outputAspect =
            1920 / 1080;

        let drawWidth = 1920;
        let drawHeight = 1080;
        let drawX = 0;
        let drawY = 0;

        if (
            sourceAspect >
            outputAspect
        ) {
            drawHeight =
                1920 /
                sourceAspect;

            drawY =
                (1080 -
                    drawHeight) /
                2;
        } else {
            drawWidth =
                1080 *
                sourceAspect;

            drawX =
                (1920 -
                    drawWidth) /
                2;
        }

        context.drawImage(
            video,
            drawX,
            drawY,
            drawWidth,
            drawHeight
        );

        const imageData =
            context.getImageData(
                0,
                0,
                1920,
                1080
            );

        const pixels =
            imageData.data;

        /*
            Canvas entrega RGBA.

            Nosso engine NDI está
            esperando BGRA.

            Então trocamos R e B.
        */
        for (
            let index = 0;
            index < pixels.length;
            index += 4
        ) {
            const red =
                pixels[index];

            pixels[index] =
                pixels[index + 2];

            pixels[index + 2] =
                red;
        }

        window.santtosAPI
            .sendNdiFrame(
                new Uint8Array(
                    pixels.buffer
                )
            );
    };

    const timer =
        window.setInterval(
            sendFrame,
            100
        );

    return () => {
        window.clearInterval(
            timer
        );
    };
}, []);
    
function addTimelineItem(
    mediaItem: MediaItem,
    targetMediaId?: string
) {
    const originalMediaId =
        mediaItem.sourceMediaId ??
        mediaItem.id;

    const timelineItem: MediaItem = {
        ...mediaItem,

        id: `${originalMediaId}-${Date.now()}-${Math.random()
            .toString(16)
            .slice(2)}`,

        sourceMediaId:
            originalMediaId
    };

    setTimelineQueue(
        (currentQueue) => {
            if (!targetMediaId) {
                return [
                    ...currentQueue,
                    timelineItem
                ];
            }

            const targetIndex =
                currentQueue.findIndex(
                    (item) =>
                        item.id ===
                        targetMediaId
                );

            if (targetIndex < 0) {
                return [
                    ...currentQueue,
                    timelineItem
                ];
            }

            const insertIndex =
                targetMediaId ===
                selectedMedia?.id
                    ? targetIndex + 1
                    : targetIndex;

            const updatedQueue = [
                ...currentQueue
            ];

            updatedQueue.splice(
                insertIndex,
                0,
                timelineItem
            );

            return updatedQueue;
        }
    );
}
    function removeTimelineItem(
    mediaId: string
) {
    if (
        mediaId === selectedMedia?.id
    ) {
        return;
    }

    setRemovedTimelineIds(
        (currentIds) => {
            const updatedIds =
                new Set(currentIds);

            updatedIds.add(mediaId);

            return updatedIds;
        }
    );

    setTimelineQueue(
        (currentQueue) =>
            currentQueue.filter(
                (item) =>
                    item.id !== mediaId
            )
    );
}
    function toggleTimelineLoop(
    mediaId: string
) {
    setTimelineQueue(
        (currentQueue) =>
            currentQueue.map(
                (item) =>
                    item.id === mediaId
                        ? {
                              ...item,
                              loop: !item.loop
                          }
                        : item
            )
    );

    if (
        selectedMedia?.id ===
        mediaId
    ) {
        onSelectMedia({
            ...selectedMedia,
            loop:
                !selectedMedia.loop
        });
    }
}
    function toggleTimelineLoop(
    mediaId: string
) {
    setTimelineQueue(
        (currentQueue) =>
            currentQueue.map(
                (item) =>
                    item.id === mediaId
                        ? {
                              ...item,
                              loop: !item.loop
                          }
                        : item
            )
    );

    if (
        selectedMedia?.id ===
        mediaId
    ) {
        onSelectMedia({
            ...selectedMedia,
            loop:
                !selectedMedia.loop
        });
    }
}
    function cutQueueTo(
    mediaId: string
) {
    setTimelineQueue(
        (currentQueue) => {
            const targetIndex =
                currentQueue.findIndex(
                    (item) =>
                        item.id === mediaId
                );

            if (targetIndex < 0) {
                return currentQueue;
            }

            const currentIndex =
                selectedMedia
                    ? currentQueue.findIndex(
                          (item) =>
                              item.id ===
                              selectedMedia.id
                      )
                    : -1;

            if (
                currentIndex >= 0 &&
                targetIndex <= currentIndex
            ) {
                return currentQueue;
            }

            if (currentIndex >= 0) {
                return [
                    ...currentQueue.slice(
                        0,
                        currentIndex + 1
                    ),

                    ...currentQueue.slice(
                        targetIndex
                    )
                ];
            }

            return currentQueue.slice(
                targetIndex
            );
        }
    );
}
    
   function moveToNext(
    mediaId: string
) {
    setTimelineQueue(
        (currentQueue) => {
            const sourceIndex =
                currentQueue.findIndex(
                    (item) =>
                        item.id === mediaId
                );

            if (sourceIndex < 0) {
                return currentQueue;
            }

            const currentIndex =
                selectedMedia
                    ? currentQueue.findIndex(
                          (item) =>
                              item.id ===
                              selectedMedia.id
                      )
                    : -1;

            const nextIndex =
                currentIndex >= 0
                    ? currentIndex + 1
                    : 0;

            if (
                sourceIndex === nextIndex
            ) {
                return currentQueue;
            }

            const updatedQueue = [
                ...currentQueue
            ];

            const [movedItem] =
                updatedQueue.splice(
                    sourceIndex,
                    1
                );

            let insertIndex =
                nextIndex;

            if (
                sourceIndex <
                nextIndex
            ) {
                insertIndex--;
            }

            updatedQueue.splice(
                insertIndex,
                0,
                movedItem
            );

            return updatedQueue;
        }
    );
} 
   function moveTimelineItem(
    targetMediaId: string
) {
    if (
        !draggedMediaId ||
        draggedMediaId === targetMediaId
    ) {
        setDraggedMediaId(null);
        return;
    }

    setTimelineQueue((currentQueue) => {
        const sourceIndex =
            currentQueue.findIndex(
                (item) =>
                    item.id === draggedMediaId
            );

        const targetIndex =
            currentQueue.findIndex(
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
            return currentQueue;
        }

        const reorderedQueue = [
            ...currentQueue
        ];

        const [movedItem] =
            reorderedQueue.splice(
                sourceIndex,
                1
            );

        reorderedQueue.splice(
            targetIndex,
            0,
            movedItem
        );

        return reorderedQueue;
    });

    setDraggedMediaId(null);
}
    
    function getProgramVideo() {
    return document.getElementById(
        "program-video"
    ) as HTMLVideoElement | null;
}

async function playVideo() {
    if (!selectedMedia) {
        const firstMedia =
            timelineQueue[0];

        if (!firstMedia) {
            window.alert(
                "Não há vídeos na Timeline."
            );
            return;
        }

        onSelectMedia(firstMedia);

        window.setTimeout(
            async () => {
                const video =
                    getProgramVideo();

                if (!video) {
                    return;
                }

                try {
                    video.load();

                    await video.play();
                } catch (error) {
                    console.error(
                        "Erro ao iniciar primeiro vídeo:",
                        error
                    );

                    window.alert(
                        "Não foi possível iniciar o primeiro vídeo."
                    );
                }
            },
            150
        );

        return;
    }

    const video = getProgramVideo();

    if (!video) {
        window.alert(
            "Player PROGRAM não encontrado."
        );
        return;
    }

    try {
        if (video.readyState < 2) {
            video.load();

            await new Promise<void>(
                (resolve, reject) => {
                    const handleReady = () => {
                        cleanup();
                        resolve();
                    };

                    const handleError = () => {
                        cleanup();

                        reject(
                            new Error(
                                "O arquivo não pôde ser carregado."
                            )
                        );
                    };

                    const cleanup = () => {
                        video.removeEventListener(
                            "canplay",
                            handleReady
                        );

                        video.removeEventListener(
                            "error",
                            handleError
                        );
                    };

                    video.addEventListener(
                        "canplay",
                        handleReady
                    );

                    video.addEventListener(
                        "error",
                        handleError
                    );
                }
            );
        }

        await video.play();
    } catch (error) {
        console.error(
            "Erro ao reproduzir vídeo:",
            error
        );

        window.alert(
            `Não foi possível reproduzir o vídeo.\n\n${
                error instanceof Error
                    ? error.message
                    : String(error)
            }`
        );
    }
}
function playNextMedia() {
    if (selectedMedia?.loop) {
    const video =
        getProgramVideo();

    if (!video) {
        return;
    }

    video.currentTime = 0;

    video
        .play()
        .catch((error) => {
            console.error(
                "Erro ao repetir vídeo:",
                error
            );
        });

    return;
}
    if (!nextMedia) {
        setCurrentTime(0);
        return;
    }

    setCurrentTime(0);
    setDuration(0);

    onSelectMedia(nextMedia);

    window.setTimeout(() => {
        const video =
            getProgramVideo();

        video
            ?.play()
            .catch((error) => {
                console.error(
                    "Erro ao iniciar próximo vídeo:",
                    error
                );
            });
    }, 150);
}
    function pauseVideo() {
    getProgramVideo()?.pause();
}

function stopVideo() {
    const video = getProgramVideo();

    if (!video) {
        return;
    }

    video.pause();
    video.currentTime = 0;
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

                            <strong>
                                Saída principal
                            </strong>
                        </div>

                        <span className="program-status">
                            ● OFF AIR
                        </span>
                    </div>

                 <div className="program-monitor">
  {selectedMediaUrl ? (
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
   onEnded={playNextMedia}
/>
) : (
    "SEM SINAL"
)}
</div>

                    <div className="program-controls">
                    <button
    title="Reproduzir"
    onClick={playVideo}
>
    ▶
</button>

<button
    title="Pausar"
    onClick={pauseVideo}
>
    ⏸
</button>

<button
    title="Parar"
    onClick={stopVideo}
>
    ■
</button>
    <button
    type="button"
    title="Próximo vídeo"
    onClick={playNextMedia}
    disabled={!nextMedia}
>
    ⏭
</button>
                        

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
    {selectedMedia
        ? `${formatDuration(
              currentTime
          )} de ${formatDuration(
              duration
          )}`
        : "Aguardando reprodução"}
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
    {nextMedia
        ? formatDuration(
              nextMedia.duration
          )
        : "Fim da timeline"}
</span>
                    </section>
                </div>

          <section
    className="panel compact-logs-panel"
    onDragOver={(event) => {
        const isLibraryMedia =
            event.dataTransfer.types.includes(
                "application/x-santtos-library-media"
            );

        if (!isLibraryMedia) {
            return;
        }

        event.preventDefault();

        event.dataTransfer.dropEffect =
            "copy";
    }}
    onDrop={(event) => {
        const libraryMediaId =
            event.dataTransfer.getData(
                "application/x-santtos-library-media"
            );

        if (!libraryMediaId) {
            return;
        }

        event.preventDefault();

        const libraryMedia =
            media.find(
                (item) =>
                    item.id ===
                    libraryMediaId
            );

        if (libraryMedia) {
            addTimelineItem(
                libraryMedia
            );
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
        cutQueueTo(
            item.id
        );
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

    if (isLibraryMedia) {
        event.preventDefault();

        event.dataTransfer.dropEffect =
            "copy";

        return;
    }

    if (isCurrent) {
        return;
    }

    event.preventDefault();

    event.dataTransfer.dropEffect =
        "move";
}}
       onDrop={(event) => {
    const libraryMediaId =
        event.dataTransfer.getData(
            "application/x-santtos-library-media"
        );

    if (libraryMediaId) {
        event.preventDefault();
        event.stopPropagation();

        const libraryMedia =
            media.find(
                (mediaItem) =>
                    mediaItem.id ===
                    libraryMediaId
            );

        if (libraryMedia) {
            addTimelineItem(
                libraryMedia,
                item.id
            );
        }

        return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (!isCurrent) {
        moveTimelineItem(
            item.id
        );
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
                                    {item.name}
                                </strong>

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
    onDoubleClick={(event) =>
        event.stopPropagation()
    }
>
    {!isCurrent && (
        <button
            type="button"
            className="timeline-next-button"
            title="Colocar como próximo"
            onClick={() =>
                moveToNext(
                    item.id
                )
            }
            draggable={false}
        >
            ⏭
        </button>
    )}

    <button
        type="button"
        className={
            item.loop
                ? "timeline-loop-button active"
                : "timeline-loop-button"
        }
        title={
            item.loop
                ? "Desativar loop"
                : "Ativar loop"
        }
        onClick={() =>
            toggleTimelineLoop(
                item.id
            )
        }
        draggable={false}
    >
        ↻
    </button>

    {!isCurrent && (
        <button
            type="button"
            className="timeline-remove"
            title="Remover da timeline"
            onClick={() =>
                removeTimelineItem(
                    item.id
                )
            }
            draggable={false}
        >
            ×
        </button>
    )}
</div>
                        </div>
                    );
                }
            )}
        </div>
    ) : (
        <span>
            Nenhuma mídia na timeline
        </span>
    )}
</section>
            </div>

            <div className="playout-library-column">
<LibraryPanel
    media={media}
    isLoading={isLoading}
    message={message}
    selectedMedia={selectedMedia}
    onSelectMedia={onSelectMedia}
    onAddVideos={onAddVideos}
    onRemoveMedia={onRemoveMedia}
    onAddToTimeline={
        addTimelineItem
    }
/>
            </div>
        </div>
    );
}

interface LibraryPanelProps {
    media: MediaItem[];
    isLoading: boolean;
    message: string;
    selectedMedia: MediaItem | null;

    onSelectMedia: (
        media: MediaItem
    ) => void;

    onAddVideos: () =>
        Promise<void>;

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
    selectedMedia,
    onSelectMedia,
    onAddVideos,
    onRemoveMedia,
    onAddToTimeline
}: LibraryPanelProps) {
    const [search, setSearch] =
        useState("");

    const filteredMedia = useMemo(
        () => {
            const normalizedSearch =
                search.trim().toLowerCase();

            if (!normalizedSearch) {
                return media;
            }

            return media.filter((item) =>
                item.name
                    .toLowerCase()
                    .includes(normalizedSearch)
            );
        },
        [media, search]
    );

    return (
        <section className="panel module-panel">
            <div className="module-header">
                <div>
                    <div className="panel-title">
                        BIBLIOTECA
                    </div>

                    <h1>
                        Biblioteca de mídia
                    </h1>
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
                        setSearch(
                            event.target.value
                        )
                    }
                />

                <span>
                    {filteredMedia.length} de{" "}
                    {media.length} mídia(s)
                </span>
            </div>

            {message && (
                <div className="library-message">
                    {message}
                </div>
            )}

            {media.length === 0 ? (
                <div className="empty-state">
                    Nenhum vídeo cadastrado
                </div>
            ) : filteredMedia.length === 0 ? (
                <div className="empty-state">
                    Nenhum vídeo encontrado
                </div>
            ) : (
                <div className="media-list">
                   {filteredMedia.map((item) => (
    <article
        key={item.id}
        draggable
        onDragStart={(event) => {
            event.dataTransfer.effectAllowed =
                "copy";

            event.dataTransfer.setData(
                "application/x-santtos-library-media",
                item.id
            );

            event.dataTransfer.setData(
                "text/plain",
                item.id
            );
        }}
        className={
            selectedMedia?.id ===
            item.id
                ? "media-item selected"
                : "media-item"
        }
        onClick={() =>
            onSelectMedia(item)
        }
        onDoubleClick={(event) => {
    event.stopPropagation();

    onAddToTimeline(
        item
    );
}}
    >
        <div className="media-thumbnail">
            {item.extension.toUpperCase()}
        </div>

        <div className="media-information">

                                <strong>
                                    {item.name}
                                </strong>

                                <span>
                                    {item.path}
                                </span>

                                <div className="media-metadata">
                                    <span>
                                        {item.width &&
                                        item.height
                                            ? `${item.width}×${item.height}`
                                            : "Resolução desconhecida"}
                                    </span>

                                    <span>
                                        {item.videoCodec ??
                                            "Codec desconhecido"}
                                    </span>

                                    <span>
                                        {item.fps !== null
                                            ? `${item.fps.toFixed(
                                                  3
                                              )} fps`
                                            : "FPS desconhecido"}
                                    </span>

                                    <span>
                                        {formatDuration(
                                            item.duration
                                        )}
                                    </span>

                                    <span>
                                        {formatFileSize(
                                            item.fileSize
                                        )}
                                    </span>
                                </div>

                                <div
                                    className={
                                        item.status ===
                                        "compatible"
                                            ? "compatibility-badge compatible"
                                            : item.status ===
                                                "incompatible"
                                              ? "compatibility-badge incompatible"
                                              : "compatibility-badge pending"
                                    }
                                >
                                    {item.status ===
                                    "compatible"
                                        ? "● Compatível"
                                        : item.status ===
                                            "incompatible"
                                          ? "● Incompatível"
                                          : "● Analisando"}
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
    type="button"
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

interface EmptyPanelProps {
    title: string;
    message: string;
}

function EmptyPanel({
    title,
    message
}: EmptyPanelProps) {
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

function formatFileSize(
    bytes: number
): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }

    const kilobytes = bytes / 1024;

    if (kilobytes < 1024) {
        return `${kilobytes.toFixed(1)} KB`;
    }

    const megabytes = kilobytes / 1024;

    if (megabytes < 1024) {
        return `${megabytes.toFixed(1)} MB`;
    }

    const gigabytes = megabytes / 1024;

    return `${gigabytes.toFixed(2)} GB`;
}


function formatDuration(
    duration: number | null
): string {
    if (
        duration === null ||
        !Number.isFinite(duration)
    ) {
        return "Duração desconhecida";
    }

    const totalSeconds = Math.floor(duration);

    const hours = Math.floor(
        totalSeconds / 3600
    );

    const minutes = Math.floor(
        (totalSeconds % 3600) / 60
    );

    const seconds = totalSeconds % 60;

    return [
        hours,
        minutes,
        seconds
    ]
        .map((value) =>
            String(value).padStart(2, "0")
        )
        .join(":");
}
