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
        folderPath: typeof value?.folderPath === "string" ? value.folderPath.trim() : "",
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
        const loaded = Array.isArray(parsed?.categories)
            ? parsed.categories.map(normalizeCategory)
            : [];

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
        categories = DEFAULT_CATEGORIES.map((item) => ({ ...item }));
    }
}

function saveConfig() {
    if (!configFile) return;
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(
        configFile,
        JSON.stringify({ categories }, null, 2),
        "utf8"
    );
}

function getLibraryCategories() {
    return categories.map((item) => ({ ...item }));
}

function saveLibraryCategories(nextCategories) {
    if (!Array.isArray(nextCategories)) {
        throw new TypeError("Categorias da biblioteca inválidas.");
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
    categories = [...fixed, ...custom];
    saveConfig();
    return getLibraryCategories();
}

function scanLibraryCategory(categoryId) {
    const category = categories.find((item) => item.id === categoryId);
    if (!category) {
        throw new Error("Categoria da biblioteca não encontrada.");
    }

    if (!category.folderPath) {
        return { category: { ...category }, filePaths: [], folderMissing: false, unconfigured: true };
    }

    if (!fs.existsSync(category.folderPath)) {
        return { category: { ...category }, filePaths: [], folderMissing: true, unconfigured: false };
    }

    const stat = fs.statSync(category.folderPath);
    if (!stat.isDirectory()) {
        throw new Error("O caminho configurado não é uma pasta.");
    }

    const filePaths = fs.readdirSync(category.folderPath, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(category.folderPath, entry.name))
        .filter((filePath) => SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
        .sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));

    return {
        category: { ...category },
        filePaths,
        folderMissing: false,
        unconfigured: false
    };
}

module.exports = {
    initializeLibraryCategories,
    getLibraryCategories,
    saveLibraryCategories,
    scanLibraryCategory
};
