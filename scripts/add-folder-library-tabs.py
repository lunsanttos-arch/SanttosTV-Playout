from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"anchor missing: {label}")
    return text.replace(old, new, 1)

# main.js
p = Path("src/main/main.js")
t = p.read_text(encoding="utf-8")

t = replace_once(
    t,
    '''const {\n    initializePlayoutReports,\n    startPlayoutEntry,\n    finishPlayoutEntry,\n    closeOpenEntriesAsSkipped,\n    getReportFolder\n} = require(\n    "../core/reporting/playout-report"\n);''',
    '''const {\n    initializePlayoutReports,\n    startPlayoutEntry,\n    finishPlayoutEntry,\n    closeOpenEntriesAsSkipped,\n    getReportFolder\n} = require(\n    "../core/reporting/playout-report"\n);\n\nconst {\n    initializeLibraryCategories,\n    getLibraryCategories,\n    saveLibraryCategories,\n    scanLibraryCategory\n} = require(\n    "../core/library/library-categories"\n);''',
    "main library category import"
)

t = replace_once(
    t,
    '''    ipcMain.handle(\n        "settings:get",\n        async () => getSettings()\n    );''',
    '''    ipcMain.handle(\n        "library-categories:get",\n        async () => getLibraryCategories()\n    );\n\n    ipcMain.handle(\n        "library-categories:save",\n        async (_event, categories) => {\n            try {\n                return {\n                    ok: true,\n                    categories: saveLibraryCategories(categories)\n                };\n            } catch (error) {\n                return {\n                    ok: false,\n                    error: error instanceof Error\n                        ? error.message\n                        : "Não foi possível salvar as abas da Biblioteca."\n                };\n            }\n        }\n    );\n\n    ipcMain.handle(\n        "library-categories:select-folder",\n        async () => {\n            const result = await dialog.showOpenDialog(\n                mainWindow ?? undefined,\n                {\n                    title: "Selecionar pasta da Biblioteca",\n                    properties: ["openDirectory", "createDirectory"]\n                }\n            );\n\n            if (result.canceled || result.filePaths.length === 0) {\n                return { ok: false, canceled: true };\n            }\n\n            return { ok: true, folderPath: result.filePaths[0] };\n        }\n    );\n\n    ipcMain.handle(\n        "library-categories:scan",\n        async (_event, categoryId) => {\n            try {\n                return {\n                    ok: true,\n                    ...scanLibraryCategory(categoryId)\n                };\n            } catch (error) {\n                return {\n                    ok: false,\n                    error: error instanceof Error\n                        ? error.message\n                        : "Não foi possível atualizar a pasta da Biblioteca."\n                };\n            }\n        }\n    );\n\n    ipcMain.handle(\n        "settings:get",\n        async () => getSettings()\n    );''',
    "main library category ipc"
)

t = replace_once(
    t,
    '''    initializeDatabase();\n    initializePlayoutReports({''',
    '''    initializeDatabase();\n    initializeLibraryCategories(app.getPath("userData"));\n    initializePlayoutReports({''',
    "main library category init"
)
p.write_text(t, encoding="utf-8")

# preload.js
p = Path("src/main/preload.js")
t = p.read_text(encoding="utf-8")
t = replace_once(
    t,
    '''        getTimeline: () =>\n            ipcRenderer.invoke(\n                "timeline:list"\n            ),''',
    '''        getLibraryCategories: () =>\n            ipcRenderer.invoke(\n                "library-categories:get"\n            ),\n\n        saveLibraryCategories: (categories) =>\n            ipcRenderer.invoke(\n                "library-categories:save",\n                categories\n            ),\n\n        selectLibraryFolder: () =>\n            ipcRenderer.invoke(\n                "library-categories:select-folder"\n            ),\n\n        scanLibraryCategory: (categoryId) =>\n            ipcRenderer.invoke(\n                "library-categories:scan",\n                categoryId\n            ),\n\n        getTimeline: () =>\n            ipcRenderer.invoke(\n                "timeline:list"\n            ),''',
    "preload library category api"
)
p.write_text(t, encoding="utf-8")

# main.tsx CSS import
p = Path("src/renderer/src/main.tsx")
t = p.read_text(encoding="utf-8")
if 'import "./library-categories.css";' not in t:
    t = replace_once(
        t,
        'import "./library-layout.css";',
        'import "./library-layout.css";\nimport "./library-categories.css";',
        "renderer category css import"
    )
p.write_text(t, encoding="utf-8")

# BroadcastSettingsPanel.tsx
p = Path("src/renderer/src/BroadcastSettingsPanel.tsx")
t = p.read_text(encoding="utf-8")
if 'LibraryFolderSettingsTab' not in t:
    t = replace_once(
        t,
        'import WatermarkSettingsTab from "./WatermarkSettingsTab";',
        'import WatermarkSettingsTab from "./WatermarkSettingsTab";\nimport LibraryFolderSettingsTab from "./LibraryFolderSettingsTab";',
        "settings library import"
    )

t = replace_once(
    t,
    '''type SettingsTab =\n    | "output"\n    | "watermark"\n    | "hashtag";''',
    '''type SettingsTab =\n    | "output"\n    | "library"\n    | "watermark"\n    | "hashtag";''',
    "settings tab union"
)

t = replace_once(
    t,
    '''                    <button\n                        type="button"\n                        className={\n                            tab === "watermark"''',
    '''                    <button\n                        type="button"\n                        className={\n                            tab === "library"\n                                ? "active"\n                                : ""\n                        }\n                        onClick={() =>\n                            setTab("library")\n                        }\n                    >\n                        Biblioteca\n                    </button>\n                    <button\n                        type="button"\n                        className={\n                            tab === "watermark"''',
    "settings library tab button"
)

t = replace_once(
    t,
    '''            {tab === "output" ? (\n                <OutputTab\n                    output={output}\n                    patchOutput={patchOutput}\n                    patchAudio={patchAudio}\n                    patchNdi={patchNdi}\n                    patchSrt={patchSrt}\n                />\n            ) : tab === "watermark" ? (\n                <WatermarkSettingsTab />\n            ) : (''',
    '''            {tab === "output" ? (\n                <OutputTab\n                    output={output}\n                    patchOutput={patchOutput}\n                    patchAudio={patchAudio}\n                    patchNdi={patchNdi}\n                    patchSrt={patchSrt}\n                />\n            ) : tab === "library" ? (\n                <LibraryFolderSettingsTab />\n            ) : tab === "watermark" ? (\n                <WatermarkSettingsTab />\n            ) : (''',
    "settings library tab body"
)

t = t.replace(
    'tab === "watermark"\n                            ? { display: "none" }',
    '(tab === "watermark" || tab === "library")\n                            ? { display: "none" }',
    1
)
p.write_text(t, encoding="utf-8")

# App.tsx
p = Path("src/renderer/src/App.tsx")
t = p.read_text(encoding="utf-8")

t = replace_once(
    t,
    '''interface SaveHashtagStyleResult {\n    ok: boolean;\n    hashtagStyle: HashtagStyle;\n}\n''',
    '''interface SaveHashtagStyleResult {\n    ok: boolean;\n    hashtagStyle: HashtagStyle;\n}\n\ninterface LibraryCategory {\n    id: string;\n    name: string;\n    folderPath: string;\n    builtIn?: boolean;\n}\n''',
    "app category interface"
)

t = replace_once(
    t,
    '''            getTimeline: () => Promise<MediaItem[]>;''',
    '''            getLibraryCategories: () => Promise<LibraryCategory[]>;\n            saveLibraryCategories: (categories: LibraryCategory[]) => Promise<{\n                ok: boolean;\n                categories?: LibraryCategory[];\n                error?: string;\n            }>;\n            selectLibraryFolder: () => Promise<{\n                ok: boolean;\n                canceled?: boolean;\n                folderPath?: string;\n            }>;\n            scanLibraryCategory: (categoryId: string) => Promise<{\n                ok: boolean;\n                category?: LibraryCategory;\n                filePaths?: string[];\n                folderMissing?: boolean;\n                unconfigured?: boolean;\n                error?: string;\n            }>;\n            getTimeline: () => Promise<MediaItem[]>;''',
    "app category api types"
)

# Remove Biblioteca from left sidebar only.
t = t.replace('        { panel: "library", icon: "📁", label: "Biblioteca" },\n', '', 1)

start = t.index('function LibraryPanel({')
end = t.index('\nfunction HashtagSettingsPanel(', start)
old_block = t[start:end]
new_block = r'''function LibraryPanel({
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
        const created: LibraryCategory = {
            id: `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            name: name.slice(0, 40),
            folderPath: "",
            builtIn: false
        };
        const result = await window.santtosAPI.saveLibraryCategories([...categories, created]);
        if (!result.ok) {
            setCategoryStatus(result.error ?? "Não foi possível criar a aba.");
            return;
        }
        const saved = result.categories ?? [...categories, created];
        setCategories(saved);
        setActiveCategoryId(created.id);
        setCategoryStatus("Aba criada. Configure a pasta em Configurações → Biblioteca.");
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
'''
t = t[:start] + new_block + t[end:]
p.write_text(t, encoding="utf-8")

print("Folder-backed library tabs applied")
