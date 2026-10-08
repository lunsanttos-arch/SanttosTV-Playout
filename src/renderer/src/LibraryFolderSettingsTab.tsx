import {
    useEffect,
    useState
} from "react";

export interface LibraryCategory {
    id: string;
    name: string;
    folderPath: string;
    builtIn?: boolean;
}

interface ServerMediaSettings {
    enabled: boolean;
    rootPath: string;
    cacheEnabled: boolean;
    cacheMaxGb: number;
    prefetchNext: boolean;
    cacheFolder: string;
}

interface ServerMediaStatus {
    enabled: boolean;
    rootPath: string;
    cacheEnabled: boolean;
    cacheMaxGb: number;
    prefetchNext: boolean;
    cacheFolder: string;
    cachedFiles: number;
    cachedBytes: number;
    activeJobs: number;
    serverReachable: boolean | null;
    lastServerCheckAt: number;
    error: string | null;
}

const DEFAULT_SERVER_MEDIA: ServerMediaSettings = {
    enabled: false,
    rootPath: "",
    cacheEnabled: true,
    cacheMaxGb: 80,
    prefetchNext: true,
    cacheFolder: ""
};

function formatBytes(value: number) {
    const bytes =
        Number.isFinite(value)
            ? Math.max(0, value)
            : 0;

    if (bytes >= 1024 ** 3) {
        return (
            bytes / 1024 ** 3
        ).toFixed(1) + " GB";
    }

    if (bytes >= 1024 ** 2) {
        return (
            bytes / 1024 ** 2
        ).toFixed(0) + " MB";
    }

    return (
        bytes / 1024
    ).toFixed(0) + " KB";
}

export default function LibraryFolderSettingsTab() {
    const [categories, setCategories] =
        useState<LibraryCategory[]>([]);
    const [status, setStatus] =
        useState("");
    const [saving, setSaving] =
        useState(false);

    const [
        serverMedia,
        setServerMedia
    ] =
        useState<ServerMediaSettings>(
            DEFAULT_SERVER_MEDIA
        );
    const [
        serverStatus,
        setServerStatus
    ] =
        useState<ServerMediaStatus | null>(
            null
        );
    const [
        serverSaving,
        setServerSaving
    ] =
        useState(false);

    async function load() {
        try {
            const [
                categoriesResult,
                serverResult
            ] =
                await Promise.all([
                    (window as any)
                        .santtosAPI
                        .getLibraryCategories(),
                    (window as any)
                        .santtosAPI
                        .getServerMediaSettings()
                ]);

            setCategories(
                categoriesResult ?? []
            );

            if (
                serverResult?.ok &&
                serverResult.settings
            ) {
                setServerMedia(
                    serverResult.settings
                );
                setServerStatus(
                    serverResult.status ??
                        null
                );
            }
        } catch (error) {
            console.error(error);
            setStatus(
                "Não foi possível carregar as pastas da Biblioteca."
            );
        }
    }

    useEffect(() => {
        void load();
    }, []);

    async function chooseFolder(
        id: string
    ) {
        try {
            const result =
                await (window as any)
                    .santtosAPI
                    .selectLibraryFolder();

            if (
                !result?.ok ||
                !result.folderPath
            ) {
                return;
            }

            setCategories(
                (current) =>
                    current.map(
                        (item) =>
                            item.id === id
                                ? {
                                      ...item,
                                      folderPath:
                                          result.folderPath
                                  }
                                : item
                    )
            );
            setStatus("");
        } catch (error) {
            console.error(error);
            setStatus(
                "Não foi possível selecionar a pasta."
            );
        }
    }

    function folderNameFromPath(
        folderPath: string
    ) {
        const normalized =
            folderPath
                .replace(
                    /[\\/]+$/,
                    ""
                )
                .replace(
                    /\\/g,
                    "/"
                );

        const segments =
            normalized
                .split("/")
                .filter(Boolean);

        return (
            segments[
                segments.length - 1
            ] ??
            "Nova pasta"
        ).slice(
            0,
            40
        );
    }

    async function createCategory() {
        setStatus(
            "Selecione a pasta que deseja adicionar..."
        );

        try {
            const result =
                await (window as any)
                    .santtosAPI
                    .selectLibraryFolder();

            if (
                !result?.ok ||
                !result.folderPath
            ) {
                setStatus(
                    result?.canceled
                        ? "Criação cancelada."
                        : "Não foi possível selecionar a pasta."
                );
                return;
            }

            const normalized =
                String(
                    result.folderPath
                )
                    .replace(
                        /\\/g,
                        "/"
                    )
                    .replace(
                        /\/+$/,
                        ""
                    )
                    .toLowerCase();

            const duplicate =
                categories.find(
                    (item) =>
                        item.folderPath
                            .replace(
                                /\\/g,
                                "/"
                            )
                            .replace(
                                /\/+$/,
                                ""
                            )
                            .toLowerCase() ===
                        normalized
                );

            if (duplicate) {
                setStatus(
                    `A pasta já está cadastrada como "${duplicate.name}".`
                );
                return;
            }

            const id =
                `custom-${Date.now()}-${Math.random()
                    .toString(16)
                    .slice(2)}`;

            setCategories(
                (current) => [
                    ...current,
                    {
                        id,
                        name:
                            folderNameFromPath(
                                result.folderPath
                            ),
                        folderPath:
                            result.folderPath,
                        builtIn: false
                    }
                ]
            );

            setStatus(
                "Pasta adicionada. Clique em Salvar pastas para confirmar."
            );
        } catch (error) {
            console.error(error);
            setStatus(
                "Não foi possível selecionar a nova pasta."
            );
        }
    }

    function removeCategory(
        id: string
    ) {
        setCategories(
            (current) =>
                current.filter(
                    (item) =>
                        item.id !== id
                )
        );
        setStatus("");
    }

    async function save() {
        setSaving(true);

        try {
            const result =
                await (window as any)
                    .santtosAPI
                    .saveLibraryCategories(
                        categories
                    );

            if (!result?.ok) {
                throw new Error(
                    result?.error ??
                    "Falha ao salvar"
                );
            }

            const saved =
                result.categories ??
                categories;

            setCategories(saved);

            window.dispatchEvent(
                new CustomEvent(
                    "santtos:library-categories-updated",
                    {
                        detail:
                            saved
                    }
                )
            );

            setStatus(
                "Pastas da Biblioteca salvas e sincronizadas."
            );
        } catch (error) {
            console.error(error);
            setStatus(
                "Não foi possível salvar as pastas da Biblioteca."
            );
        } finally {
            setSaving(false);
        }
    }

    async function chooseServerRoot() {
        try {
            const result =
                await (window as any)
                    .santtosAPI
                    .selectServerMediaRoot();

            if (
                !result?.ok ||
                !result.folderPath
            ) {
                return;
            }

            setServerMedia(
                (current) => ({
                    ...current,
                    rootPath:
                        result.folderPath
                })
            );
        } catch (error) {
            console.error(error);
            setStatus(
                "Não foi possível selecionar a raiz do servidor."
            );
        }
    }

    async function saveServer() {
        if (
            serverMedia.enabled &&
            !serverMedia.rootPath.trim()
        ) {
            setStatus(
                "Informe a raiz do servidor antes de ativar o modo Server Media."
            );
            return;
        }

        setServerSaving(true);

        try {
            const result =
                await (window as any)
                    .santtosAPI
                    .saveServerMediaSettings({
                        enabled:
                            serverMedia.enabled,
                        rootPath:
                            serverMedia.rootPath,
                        cacheEnabled:
                            serverMedia.cacheEnabled,
                        cacheMaxGb:
                            Number(
                                serverMedia.cacheMaxGb
                            ),
                        prefetchNext:
                            serverMedia.prefetchNext
                    });

            if (!result?.ok) {
                throw new Error(
                    result?.error ??
                    "Falha ao salvar Server Media"
                );
            }

            if (
                result.settings
            ) {
                setServerMedia(
                    result.settings
                );
            }

            setServerStatus(
                result.status ??
                    null
            );

            setStatus(
                serverMedia.enabled
                    ? "Server Media ativado. O próximo material será preparado no cache local."
                    : "Server Media desativado."
            );
        } catch (error) {
            console.error(error);
            setStatus(
                "Não foi possível salvar as configurações do servidor."
            );
        } finally {
            setServerSaving(false);
        }
    }

    async function clearServerCache() {
        if (
            !window.confirm(
                "Limpar todas as cópias locais do Server Media? Os arquivos originais do servidor não serão apagados."
            )
        ) {
            return;
        }

        try {
            const result =
                await (window as any)
                    .santtosAPI
                    .clearServerMediaCache();

            if (!result?.ok) {
                throw new Error(
                    result?.error ??
                    "Falha ao limpar cache"
                );
            }

            setServerStatus(
                result.status ??
                    null
            );

            setStatus(
                "Cache local do servidor limpo."
            );
        } catch (error) {
            console.error(error);
            setStatus(
                "Não foi possível limpar o cache agora."
            );
        }
    }

    return (
        <div className="library-settings-tab">
            <section className="server-media-settings">
                <div className="server-media-heading">
                    <div>
                        <div className="server-media-eyebrow">
                            SERVER MEDIA
                        </div>
                        <h2>Execução a partir do servidor</h2>
                        <p>
                            A Biblioteca aponta para o servidor, mas o próximo material é preparado no NVMe local antes de entrar no ar.
                        </p>
                    </div>

                    <span
                        className={
                            serverStatus?.serverReachable === false
                                ? "server-media-health offline"
                                : serverStatus?.serverReachable === true
                                  ? "server-media-health online"
                                  : "server-media-health"
                        }
                    >
                        {serverStatus?.serverReachable === false
                            ? "SERVIDOR OFFLINE"
                            : serverStatus?.serverReachable === true
                              ? "SERVIDOR ONLINE"
                              : serverMedia.enabled
                                ? "AGUARDANDO TESTE"
                                : "DESATIVADO"}
                    </span>
                </div>

                <div className="server-media-grid">
                    <label className="server-media-toggle">
                        <input
                            type="checkbox"
                            checked={
                                serverMedia.enabled
                            }
                            onChange={(event) =>
                                setServerMedia(
                                    (current) => ({
                                        ...current,
                                        enabled:
                                            event.currentTarget.checked
                                    })
                                )
                            }
                        />
                        <span>
                            <strong>Ativar modo servidor</strong>
                            <small>Reconhece a raiz configurada como mídia remota e habilita failover por cache.</small>
                        </span>
                    </label>

                    <div className="server-media-path-field">
                        <label>
                            Raiz do servidor
                        </label>
                        <div>
                            <input
                                value={
                                    serverMedia.rootPath
                                }
                                onChange={(event) =>
                                    setServerMedia(
                                        (current) => ({
                                            ...current,
                                            rootPath:
                                                event.currentTarget.value
                                        })
                                    )
                                }
                                placeholder="\\SERVIDOR\MIDIA"
                            />
                            <button
                                type="button"
                                onClick={() =>
                                    void chooseServerRoot()
                                }
                            >
                                Selecionar
                            </button>
                        </div>
                        <small>
                            Pode ser UNC, por exemplo \\SERVIDOR\MIDIA, ou uma unidade de rede mapeada. A autenticação permanece no Windows.
                        </small>
                    </div>

                    <label className="server-media-toggle">
                        <input
                            type="checkbox"
                            checked={
                                serverMedia.cacheEnabled
                            }
                            onChange={(event) =>
                                setServerMedia(
                                    (current) => ({
                                        ...current,
                                        cacheEnabled:
                                            event.currentTarget.checked
                                    })
                                )
                            }
                        />
                        <span>
                            <strong>Cache local de segurança</strong>
                            <small>Executa a cópia local quando disponível e mantém o PROGRAM protegido contra oscilações da rede.</small>
                        </span>
                    </label>

                    <label className="server-media-number">
                        <span>Limite do cache</span>
                        <div>
                            <input
                                type="number"
                                min={5}
                                max={1000}
                                step={5}
                                value={
                                    serverMedia.cacheMaxGb
                                }
                                onChange={(event) =>
                                    setServerMedia(
                                        (current) => ({
                                            ...current,
                                            cacheMaxGb:
                                                Number(
                                                    event.currentTarget.value
                                                )
                                        })
                                    )
                                }
                            />
                            <strong>GB</strong>
                        </div>
                    </label>

                    <label className="server-media-toggle">
                        <input
                            type="checkbox"
                            checked={
                                serverMedia.prefetchNext
                            }
                            onChange={(event) =>
                                setServerMedia(
                                    (current) => ({
                                        ...current,
                                        prefetchNext:
                                            event.currentTarget.checked
                                    })
                                )
                            }
                        />
                        <span>
                            <strong>Pré-carregar próximo material</strong>
                            <small>Assim que a timeline define o próximo item, a transferência começa em segundo plano.</small>
                        </span>
                    </label>

                    <div className="server-media-cache-status">
                        <span>Cache local</span>
                        <strong>
                            {serverStatus
                                ? `${serverStatus.cachedFiles} arquivo(s) · ${formatBytes(serverStatus.cachedBytes)}`
                                : "Ainda sem dados"}
                        </strong>
                        <small
                            title={
                                serverMedia.cacheFolder
                            }
                        >
                            {serverMedia.cacheFolder ||
                                "A pasta de cache será criada automaticamente."}
                        </small>
                    </div>
                </div>

                <div className="server-media-actions">
                    <button
                        type="button"
                        className="secondary-button"
                        onClick={() =>
                            void clearServerCache()
                        }
                    >
                        Limpar cache
                    </button>

                    <button
                        type="button"
                        className="primary-button"
                        disabled={
                            serverSaving
                        }
                        onClick={() =>
                            void saveServer()
                        }
                    >
                        {serverSaving
                            ? "Salvando..."
                            : "Salvar servidor"}
                    </button>
                </div>
            </section>

            <div className="library-settings-intro">
                <div>
                    <h2>Pastas da Biblioteca</h2>
                    <p>
                        Cada sub-aba do Playout exibe somente os arquivos da pasta configurada aqui. As pastas podem estar dentro da raiz do servidor.
                    </p>
                </div>

                <button
                    type="button"
                    onClick={() =>
                        void createCategory()
                    }
                >
                    + Nova pasta
                </button>
            </div>

            <div className="library-folder-list">
                {categories.map(
                    (category) => (
                        <div
                            className="library-folder-row"
                            key={
                                category.id
                            }
                        >
                            <div className="library-folder-name">
                                <strong>
                                    {category.name}
                                </strong>
                                <span>
                                    {category.builtIn
                                        ? "Aba padrão"
                                        : "Aba personalizada"}
                                </span>
                            </div>

                            <div
                                className="library-folder-path"
                                title={
                                    category.folderPath ||
                                    "Sem pasta configurada"
                                }
                            >
                                {category.folderPath ||
                                    "Nenhuma pasta configurada"}
                            </div>

                            <button
                                type="button"
                                onClick={() =>
                                    void chooseFolder(
                                        category.id
                                    )
                                }
                            >
                                Escolher pasta
                            </button>

                            {!category.builtIn && (
                                <button
                                    type="button"
                                    className="danger-button"
                                    onClick={() =>
                                        removeCategory(
                                            category.id
                                        )
                                    }
                                >
                                    Excluir aba
                                </button>
                            )}
                        </div>
                    )
                )}
            </div>

            <div className="library-settings-actions">
                <span>{status}</span>

                <button
                    className="primary-button"
                    type="button"
                    disabled={saving}
                    onClick={() =>
                        void save()
                    }
                >
                    {saving
                        ? "Salvando..."
                        : "Salvar pastas"}
                </button>
            </div>
        </div>
    );
}
