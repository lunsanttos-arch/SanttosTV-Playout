const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const databaseFolder = path.join(
    __dirname,
    "../../database"
);

const databaseFile = path.join(
    databaseFolder,
    "santtos-tv.json"
);

const initialData = {
    settings: {
        channelName: "Santtos TV",
        resolution: "1920x1080",
        fps: "59.94",
        ndiName: "Santtos TV Playout"
    },

    media: [],
    playlists: [],
    logs: []
};

let data = structuredClone(initialData);

function ensureDatabaseFolder() {
    if (!fs.existsSync(databaseFolder)) {
        fs.mkdirSync(databaseFolder, {
            recursive: true
        });
    }
}

function saveDatabase() {
    ensureDatabaseFolder();

    fs.writeFileSync(
        databaseFile,
        JSON.stringify(data, null, 2),
        "utf8"
    );
}

function loadDatabase() {
    ensureDatabaseFolder();

    if (!fs.existsSync(databaseFile)) {
        data = structuredClone(initialData);
        saveDatabase();
        return;
    }

    try {
        const fileContent = fs.readFileSync(
            databaseFile,
            "utf8"
        );

        const parsedData = JSON.parse(fileContent);

        data = {
            ...structuredClone(initialData),
            ...parsedData,

            settings: {
                ...initialData.settings,
                ...(parsedData.settings ?? {})
            },

            media: Array.isArray(parsedData.media)
                ? parsedData.media
                : [],

            playlists: Array.isArray(parsedData.playlists)
                ? parsedData.playlists
                : [],

            logs: Array.isArray(parsedData.logs)
                ? parsedData.logs
                : []
        };
    } catch (error) {
        console.error(
            "Não foi possível carregar o banco:",
            error
        );

        const corruptedFile = path.join(
            databaseFolder,
            `santtos-tv-corrompido-${Date.now()}.json`
        );

        try {
            fs.copyFileSync(
                databaseFile,
                corruptedFile
            );
        } catch {
            // O programa continua mesmo que o backup falhe.
        }

        data = structuredClone(initialData);
        saveDatabase();
    }
}

function initializeDatabase() {
    loadDatabase();
}

function addLog(message, level = "info") {
    const log = {
        id: crypto.randomUUID(),
        message,
        level,
        createdAt: new Date().toISOString()
    };

    data.logs.unshift(log);

    if (data.logs.length > 1000) {
        data.logs = data.logs.slice(0, 1000);
    }

    saveDatabase();

    return log;
}

function getMedia() {
    return [...data.media];
}

function addMedia(filePaths) {
    if (!Array.isArray(filePaths)) {
        throw new TypeError(
            "A lista de arquivos é inválida."
        );
    }

    const existingPaths = new Set(
        data.media.map((item) =>
            normalizePath(item.path)
        )
    );

    const importedItems = [];
    const duplicatedItems = [];

    for (const filePath of filePaths) {
        if (
            typeof filePath !== "string" ||
            filePath.trim() === ""
        ) {
            continue;
        }

        const normalizedPath =
            normalizePath(filePath);

        if (existingPaths.has(normalizedPath)) {
            duplicatedItems.push(filePath);
            continue;
        }

        if (!fs.existsSync(filePath)) {
            continue;
        }

        const extension = path
            .extname(filePath)
            .replace(".", "")
            .toLowerCase();

        if (!["mp4", "mov"].includes(extension)) {
            continue;
        }

        const statistics = fs.statSync(filePath);

        const item = {
            id: crypto.randomUUID(),

            name: path.basename(filePath),
            path: filePath,
            extension,

            fileSize: statistics.size,

            duration: null,
            width: null,
            height: null,
            fps: null,
            videoCodec: null,
            audioCodec: null,
            thumbnail: null,

            status: "pending-metadata",

            createdAt: new Date().toISOString()
        };

        data.media.push(item);
        importedItems.push(item);
        existingPaths.add(normalizedPath);
    }

    if (importedItems.length > 0) {
        saveDatabase();

        addLog(
            `${importedItems.length} mídia(s) adicionada(s) à biblioteca.`
        );
    }

    return {
        importedItems,
        duplicatedItems,
        media: getMedia()
    };
}

function removeMedia(mediaId) {
    const mediaIndex = data.media.findIndex(
        (item) => item.id === mediaId
    );

    if (mediaIndex === -1) {
        return {
            removed: false,
            media: getMedia()
        };
    }

    const [removedItem] = data.media.splice(
        mediaIndex,
        1
    );

    saveDatabase();

    addLog(
        `Mídia removida da biblioteca: ${removedItem.name}`
    );

    return {
        removed: true,
        removedItem,
        media: getMedia()
    };
}

function normalizePath(filePath) {
    return path
        .resolve(filePath)
        .replaceAll("\\", "/")
        .toLowerCase();
}
function updateMediaMetadata(
    mediaId,
    metadata
) {
    const mediaItem =
        data.media.find(
            (item) =>
                item.id === mediaId
        );

    if (!mediaItem) {
        return null;
    }

    Object.assign(
        mediaItem,
        metadata,
        {
            metadataUpdatedAt:
                new Date()
                    .toISOString()
        }
    );

    saveDatabase();

    return {
        ...mediaItem
    };
}
module.exports = {
    initializeDatabase,
    addLog,
    getMedia,
    addMedia,
    removeMedia,
    updateMediaMetadata
};
