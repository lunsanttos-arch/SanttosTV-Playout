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
    timeline: [],
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
                ? parsedData.media.map((item) => {
                      const {
                          hashtag: _legacyHashtag,
                          ...cleanItem
                      } = item;

                      return cleanItem;
                  })
                : [],

            timeline: Array.isArray(parsedData.timeline)
                ? parsedData.timeline.map((entry) => ({
                      ...entry,
                      hashtag:
                          normalizeHashtag(
                              entry?.hashtag ?? ""
                          )
                  }))
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
    return data.media.map((item) => ({
        ...item
    }));
}

function getTimeline() {
    const mediaById = new Map(
        data.media.map((item) => [
            item.id,
            item
        ])
    );

    return data.timeline
        .map((entry) => {
            const sourceMedia =
                mediaById.get(
                    entry.sourceMediaId
                );

            if (!sourceMedia) {
                return null;
            }

            return {
                ...sourceMedia,
                id: entry.id,
                sourceMediaId:
                    entry.sourceMediaId,
                loop: Boolean(entry.loop),
                hashtag:
                    normalizeHashtag(
                        entry.hashtag ?? ""
                    )
            };
        })
        .filter(Boolean);
}

function saveTimeline(timelineItems) {
    if (!Array.isArray(timelineItems)) {
        throw new TypeError(
            "A timeline é inválida."
        );
    }

    const existingMediaIds = new Set(
        data.media.map((item) => item.id)
    );

    data.timeline = timelineItems
        .map((item) => {
            const sourceMediaId =
                item?.sourceMediaId ??
                item?.id;

            if (
                typeof item?.id !== "string" ||
                typeof sourceMediaId !== "string" ||
                !existingMediaIds.has(
                    sourceMediaId
                )
            ) {
                return null;
            }

            return {
                id: item.id,
                sourceMediaId,
                loop: Boolean(item.loop),
                hashtag:
                    normalizeHashtag(
                        item.hashtag ?? ""
                    )
            };
        })
        .filter(Boolean);

    saveDatabase();

    return getTimeline();
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

    data.timeline = data.timeline.filter(
        (entry) =>
            entry.sourceMediaId !== mediaId
    );

    saveDatabase();

    addLog(
        `Mídia removida da biblioteca: ${removedItem.name}`
    );

    return {
        removed: true,
        removedItem,
        media: getMedia(),
        timeline: getTimeline()
    };
}

function normalizeHashtag(value) {
    if (typeof value !== "string") {
        return "";
    }

    const trimmed = value
        .trim()
        .replace(/\s+/g, "");

    if (!trimmed) {
        return "";
    }

    const withHash = trimmed.startsWith("#")
        ? trimmed
        : `#${trimmed}`;

    return withHash.slice(0, 80);
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
    getTimeline,
    saveTimeline,
    addMedia,
    removeMedia,
    updateMediaMetadata
};
