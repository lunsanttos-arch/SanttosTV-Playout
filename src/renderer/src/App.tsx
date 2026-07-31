import {
    useEffect,
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
}

declare global {
    interface Window {
        santtosAPI: {
            selectVideos: () => Promise<string[]>;
        };
    }
}

function getFileName(filePath: string): string {
    return filePath
        .replaceAll("\\", "/")
        .split("/")
        .pop() ?? filePath;
}

export default function App() {
    const [clock, setClock] = useState("00:00:00");
    const [activePanel, setActivePanel] =
        useState<Panel>("playout");

    const [media, setMedia] =
        useState<MediaItem[]>([]);

    useEffect(() => {
        const updateClock = () => {
            setClock(
                new Date().toLocaleTimeString("pt-BR")
            );
        };

        updateClock();

        const timer = window.setInterval(
            updateClock,
            1000
        );

        return () => {
            window.clearInterval(timer);
        };
    }, []);

    async function addVideos() {
        const selectedFiles =
            await window.santtosAPI.selectVideos();

        if (!selectedFiles.length) {
            return;
        }

        const newMedia = selectedFiles.map(
            (filePath, index) => ({
                id: `${Date.now()}-${index}`,
                name: getFileName(filePath),
                path: filePath
            })
        );

        setMedia((currentMedia) => [
            ...currentMedia,
            ...newMedia
        ]);
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
                <aside className="sidebar">
                    <button
                        className={
                            activePanel === "playout"
                                ? "active"
                                : ""
                        }
                        onClick={() =>
                            setActivePanel("playout")
                        }
                    >
                        📺 Playout
                    </button>

                    <button
                        className={
                            activePanel === "library"
                                ? "active"
                                : ""
                        }
                        onClick={() =>
                            setActivePanel("library")
                        }
                    >
                        📁 Biblioteca
                    </button>

                    <button
                        className={
                            activePanel === "playlist"
                                ? "active"
                                : ""
                        }
                        onClick={() =>
                            setActivePanel("playlist")
                        }
                    >
                        📋 Playlist
                    </button>

                    <button
                        className={
                            activePanel === "scheduler"
                                ? "active"
                                : ""
                        }
                        onClick={() =>
                            setActivePanel("scheduler")
                        }
                    >
                        🗓 Scheduler
                    </button>

                    <button
                        className={
                            activePanel === "settings"
                                ? "active"
                                : ""
                        }
                        onClick={() =>
                            setActivePanel("settings")
                        }
                    >
                        ⚙ Configurações
                    </button>
                </aside>

                <main className="main-content">
                    {activePanel === "playout" && (
                        <PlayoutPanel />
                    )}

                    {activePanel === "library" && (
                        <LibraryPanel
                            media={media}
                            onAddVideos={addVideos}
                        />
                    )}

                    {activePanel === "playlist" && (
                        <EmptyPanel
                            title="Playlist"
                            message="A programação será montada aqui."
                        />
                    )}

                    {activePanel === "scheduler" && (
                        <EmptyPanel
                            title="Scheduler"
                            message="A programação por horário será configurada aqui."
                        />
                    )}

                    {activePanel === "settings" && (
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
                    Playout v0.2 Alpha
                </span>
            </footer>
        </div>
    );
}

function PlayoutPanel() {
    return (
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

                <strong>Nenhum conteúdo</strong>
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
    onAddVideos: () => Promise<void>;
}

function LibraryPanel({
    media,
    onAddVideos
}: LibraryPanelProps) {
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
                >
                    + Adicionar vídeos
                </button>
            </div>

            {media.length === 0 ? (
                <div className="empty-state">
                    Nenhum vídeo cadastrado
                </div>
            ) : (
                <div className="media-list">
                    {media.map((item) => (
                        <article
                            className="media-item"
                            key={item.id}
                        >
                            <div className="media-thumbnail">
                                VIDEO
                            </div>

                            <div className="media-information">
                                <strong>{item.name}</strong>
                                <span>{item.path}</span>
                                <small>
                                    Metadados aguardando FFprobe
                                </small>
                            </div>
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
