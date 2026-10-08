const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_CATEGORIES = [
    { id: "comerciais", name: "Comerciais", folderPath: "", builtIn: true },
    { id: "chamadas", name: "Chamadas", folderPath: "", builtIn: true },
    { id: "vinhetas", name: "Vinhetas", folderPath: "", builtIn: true },
    { id: "drops", name: "Drops", folderPath: "", builtIn: true }
];

const SUPPORTED_EXTENSIONS = new Set([
    ".mp4", ".mov", ".mkv", ".avi", ".mxf", ".ts", ".mts", ".m2ts",
    ".webm", ".mpg", ".mpeg", ".m4v", ".wmv"
]);

let configFile = "";
let categories = DEFAULT_CATEGORIES.map((item) => ({ ...item }));

function withTimeout(
    promise,
    timeoutMs,
    message
) {
    let timer = null;

    const timeout =
        new Promise(
            (_resolve, reject) => {
                timer =
                    setTimeout(
                        () => {
                            const error =
                                new Error(
                                    message
                                );

                            error.code =
                                "ETIMEDOUT";

                            reject(error);
                        },
                        timeoutMs
                    );
            }
        );

    return Promise.race([
        promise,
        timeout
    ]).finally(() => {
        if (timer) {
            clearTimeout(timer);
        }
    });
}

function isUnavailableFolderError(error) {
    return Boolean(
        error &&
        (
            error.code === "ENOENT" ||
            error.code === "ENOTDIR" ||
            error.code === "ENETUNREACH" ||
            error.code === "EHOSTUNREACH" ||
            error.code === "ETIMEDOUT" ||
            error.code === "ECONNREFUSED"
        )
    );
}

function initializeLibraryCategories(userDataPath) {
    configFile = path.join(userDataPath, "library-categories.json");
    loadCategories();
}

function normalizeCategory(value, index = 0) {
    const name = String(value?.name ?? "").trim().slice(0, 40) || `Aba ${index + 1}`;
    const rawId = String(value?.id ?? "").trim();
    const id = rawId || `custom-${crypto.randomUUID()}`;
    return {
        id: id.slice(0, 120),
        name,
        folderPath: typeof value?.folderPath === "string" ? value.folderPath.trim().slice(0, 4096) : "",
        builtIn: Boolean(value?.builtIn)
    };
}

function loadCategories() {
    if (!configFile || !fs.existsSync(configFile)) {
        categories = DEFAULT_CATEGORIES.map((item) => ({ ...item }));
        saveConfig();
        return;
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(configFile, "utf8"));
        if (!Array.isArray(parsed?.categories)) {
            throw new Error("Estrutura das abas da biblioteca invalida.");
        }
        const loaded = parsed.categories.map(normalizeCategory);

        const byId = new Map(loaded.map((item) => [item.id, item]));
        const mergedDefaults = DEFAULT_CATEGORIES.map((fallback) => ({
            ...fallback,
            ...(byId.get(fallback.id) ?? {}),
            id: fallback.id,
            name: fallback.name,
            builtIn: true
        }));
        const custom = loaded.filter((item) => !DEFAULT_CATEGORIES.some((d) => d.id === item.id));
        categories = [...mergedDefaults, ...custom];
    } catch (error) {
        console.error("Falha ao carregar categorias da biblioteca:", error);
        try {
            fs.copyFileSync(configFile, `${configFile}.corrompido-${Date.now()}`);
        } catch (copyError) {
            console.error("Nao foi possivel salvar copia do arquivo de categorias:", copyError);
        }
        throw new Error("Abas da biblioteca danificadas. Original preservado em " +
            configFile + ". Confira o backup .bak antes de restaurar.");
    }
}

function saveConfig() {
    if (!configFile) return;
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    const temporaryFile = `${configFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
    let handle;
    try {
        handle = fs.openSync(temporaryFile, "wx");
        fs.writeFileSync(handle, JSON.stringify({ categories }, null, 2), "utf8");
        fs.fsyncSync(handle);
        fs.closeSync(handle);
        handle = undefined;
        if (fs.existsSync(configFile)) fs.copyFileSync(configFile, `${configFile}.bak`);
        fs.renameSync(temporaryFile, configFile);
    } finally {
        if (handle !== undefined) fs.closeSync(handle);
        if (fs.existsSync(temporaryFile)) fs.rmSync(temporaryFile, { force: true });
    }
}

function getLibraryCategories() {
    return categories.map((item) => ({ ...item }));
}

function saveLibraryCategories(nextCategories) {
    if (!Array.isArray(nextCategories)) {
        throw new TypeError("Categorias da biblioteca inválidas.");
    }

    if (nextCategories.length > 60) {
        throw new RangeError("Limite de 60 abas da biblioteca.");
    }
    const normalized = nextCategories
        .map(normalizeCategory)
        .filter((item, index, list) => list.findIndex((other) => other.id === item.id) === index);

    const byId = new Map(normalized.map((item) => [item.id, item]));
    const fixed = DEFAULT_CATEGORIES.map((fallback) => ({
        ...fallback,
        ...(byId.get(fallback.id) ?? {}),
        id: fallback.id,
        name: fallback.name,
        builtIn: true
    }));
    const custom = normalized.filter((item) => !DEFAULT_CATEGORIES.some((d) => d.id === item.id));
    const previous = categories;
    categories = [...fixed, ...custom];
    try {
        saveConfig();
    } catch (error) {
        categories = previous;
        throw error;
    }
    return getLibraryCategories();
}

async function scanLibraryCategory(categoryId) {
    const category = categories.find(
        (item) =>
            item.id === categoryId
    );

    if (!category) {
        throw new Error(
            "Categoria da biblioteca não encontrada."
        );
    }

    if (!category.folderPath) {
        return {
            category: {
                ...category
            },
            filePaths: [],
            folderMissing: false,
            unconfigured: true,
            networkPath: false
        };
    }

    const networkPath =
        /^\\\\/.test(
            category.folderPath
        );

    let stat;

    try {
        stat =
            await withTimeout(
                fs.promises.stat(
                    category.folderPath
                ),
                networkPath
                    ? 4000
                    : 8000,
                "Tempo limite ao acessar a pasta da Biblioteca."
            );
    } catch (error) {
        if (
            isUnavailableFolderError(
                error
            )
        ) {
            return {
                category: {
                    ...category
                },
                filePaths: [],
                folderMissing: true,
                unconfigured: false,
                networkPath
            };
        }

        throw error;
    }

    if (!stat.isDirectory()) {
        throw new Error(
            "O caminho configurado não é uma pasta."
        );
    }

    // Importante para SMB/NAS: a leitura é assíncrona para não congelar
    // o processo principal do Electron enquanto o servidor responde.
    let entries;

    try {
        entries =
            await withTimeout(
                fs.promises.readdir(
                    category.folderPath,
                    {
                        withFileTypes: true
                    }
                ),
                networkPath
                    ? 6000
                    : 12000,
                "Tempo limite ao listar a pasta da Biblioteca."
            );
    } catch (error) {
        if (
            isUnavailableFolderError(
                error
            )
        ) {
            return {
                category: {
                    ...category
                },
                filePaths: [],
                folderMissing: true,
                unconfigured: false,
                networkPath
            };
        }

        throw error;
    }

    const filePaths =
        entries
            .filter(
                (entry) =>
                    entry.isFile()
            )
            .map(
                (entry) =>
                    path.join(
                        category.folderPath,
                        entry.name
                    )
            )
            .filter(
                (filePath) =>
                    SUPPORTED_EXTENSIONS.has(
                        path
                            .extname(filePath)
                            .toLowerCase()
                    )
            )
            .sort(
                (left, right) =>
                    left.localeCompare(
                        right,
                        "pt-BR",
                        {
                            sensitivity: "base"
                        }
                    )
            );

    return {
        category: {
            ...category
        },
        filePaths,
        folderMissing: false,
        unconfigured: false,
        networkPath
    };
}

module.exports = {
    initializeLibraryCategories,
    getLibraryCategories,
    saveLibraryCategories,
    scanLibraryCategory
};
