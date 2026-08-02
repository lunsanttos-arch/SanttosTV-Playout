import {
    useEffect,
    useMemo,
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
        onAddVideos={addVideos}
        onRemoveMedia={
            handleRemoveMedia
        }
    />
)}
                    {activePanel ===
                        "library" && (
                        <LibraryPanel
                            media={media}
                            isLoading={
                                isLoading
                            }
                            message={message}
                            onAddVideos={
                                addVideos
                            }
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
    onAddVideos,
    onRemoveMedia
}: PlayoutPanelProps) {
return (
    <>
        <div className="playout-grid">
            {/* mantenha aqui todo o conteúdo atual do playout */}
        </div>

        <LibraryPanel
            media={media}
            isLoading={isLoading}
            message={message}
            onAddVideos={onAddVideos}
            onRemoveMedia={
                onRemoveMedia
            }
        />
    </>
);
        <div className="playout-grid">
            <section className="panel preview-panel">
                <div className="panel-title">
                    PROGRAM
                </div>

                <div className="video-screen">
                    SEM SINAL
                </div>
            </section>

            <section className="panel on-air-panel">
                <div className="panel-title">
                    NO AR
                </div>

                <strong>
                    Nenhum conteúdo
                </strong>

                <span>00:00:00</span>

                <div className="progress-bar">
                    <div />
                </div>
            </section>

            <section className="panel next-panel">
                <div className="panel-title">
                    PRÓXIMO
                </div>

                <span>
                    Aguardando programação
                </span>
            </section>

            <section className="panel controls-panel">
                <button>▶ PLAY</button>
                <button>⏸ PAUSE</button>
                <button>■ STOP</button>
            </section>

            <section className="panel logs-panel">
                <div className="panel-title">
                    LOGS
                </div>

                <span>Sistema iniciado</span>
            </section>
        </div>
    );
}

interface LibraryPanelProps {
    media: MediaItem[];
    isLoading: boolean;
    message: string;

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
                    .includes(
                        normalizedSearch
                    )
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
            ) : filteredMedia.length ===
              0 ? (
                <div className="empty-state">
                    Nenhum vídeo encontrado
                </div>
            ) : (
                <div className="media-list">
                    {filteredMedia.map(
                        (item) => (
                            <article
                                className="media-item"
                                key={item.id}
                            >
                                <div className="media-thumbnail">
                                    {item.extension
                                        .toUpperCase()}
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
        {item.width && item.height
            ? `${item.width}×${item.height}`
            : "Resolução desconhecida"}
    </span>

    <span>
        {item.videoCodec ?? "Codec desconhecido"}
    </span>

    <span>
        {item.fps !== null
            ? `${item.fps.toFixed(3)} fps`
            : "FPS desconhecido"}
    </span>

    <span>
        {formatDuration(item.duration)}
    </span>

    <span>
        {formatFileSize(item.fileSize)}
    </span>
</div>

<div
    className={
        item.status === "compatible"
            ? "compatibility-badge compatible"
            : item.status === "incompatible"
              ? "compatibility-badge incompatible"
              : "compatibility-badge pending"
    }
>
    {item.status === "compatible"
        ? "● Compatível"
        : item.status === "incompatible"
          ? "● Incompatível"
          : "● Analisando"}
</div>
                                </div>

                                <button
                                    className="remove-media-button"
                                    title="Remover da biblioteca"
                                    onClick={() =>
                                        onRemoveMedia(
                                            item
                                        )
                                    }
                                >
                                    Remover
                                </button>
                            </article>
                        )
                    )}
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
