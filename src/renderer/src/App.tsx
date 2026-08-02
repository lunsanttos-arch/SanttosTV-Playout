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

            getMediaFileUrl: (
                filePath: string
) => string;
        };
    }
}

export default function App() {
    const [clock, setClock] =
        useState("00:00:00");

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

        const timer = window.setInterval(
            updateClock,
            1000
        );

        return () =>
            window.clearInterval(timer);
    }, []);

    useEffect(() => {
        loadMedia();
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

                    <span>NDI OFFLINE</span>
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
    const selectedMediaUrl =
    selectedMedia
        ? encodeURI(
              `file:///${selectedMedia.path.replace(
                  /\\/g,
                  "/"
              )}`
          )
        : null;
   function getProgramVideo() {
    return document.getElementById(
        "program-video"
    ) as HTMLVideoElement | null;
}

function playVideo() {
    const video = getProgramVideo();

    if (!video) {
        console.error(
            "Player PROGRAM não encontrado."
        );
        return;
    }

    video.play().catch((error) => {
        console.error(
            "Erro ao reproduzir vídeo:",
            error
        );
    });
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
   <video
    id="program-video"
    ref={videoRef}
    className="program-video"
    src={selectedMediaUrl}
    controls
    preload="auto"
/>
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

                        <div className="program-time">
                            00:00:00 / 00:00:00
                        </div>
                    </div>

                    <div className="program-progress">
                        <div />
                    </div>
                </section>

                <div className="playout-status-row">
                    <section className="panel compact-status-card">
                        <div className="panel-title">
                            NO AR
                        </div>

                        <strong>
                            Nenhum conteúdo
                        </strong>

                        <span>
                            Aguardando reprodução
                        </span>
                    </section>

                    <section className="panel compact-status-card">
                        <div className="panel-title">
                            PRÓXIMO
                        </div>

                        <strong>
                            Nenhum conteúdo
                        </strong>

                        <span>
                            Aguardando seleção
                        </span>
                    </section>
                </div>

                <section className="panel compact-logs-panel">
                    <div className="panel-title">
                        LOGS
                    </div>

                    <span>
                        Sistema iniciado
                    </span>
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
}

function LibraryPanel({
    media,
    isLoading,
    message,
    selectedMedia,
    onSelectMedia,
    onAddVideos,
    onRemoveMedia
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
                            className={
                                selectedMedia?.id ===
                                item.id
                                    ? "media-item selected"
                                    : "media-item"
                            }
                            onClick={() =>
                                onSelectMedia(item)
                            }
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
