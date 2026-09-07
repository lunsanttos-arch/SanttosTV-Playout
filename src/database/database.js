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

const DEFAULT_HASHTAG_STYLE = {
    fontFamily: "Arial",
    fontSize: 28,
    color: "#ffffff",
    opacity: 0.68,
    x: 55,
    y: 32,
    bold: true,
    outlineWidth: 1,
    outlineColor: "#000000",
    outlineOpacity: 0.35,
    shadowEnabled: true,
    shadowColor: "#000000",
    shadowOpacity: 0.35,
    shadowX: 2,
    shadowY: 2
};

const DEFAULT_WATERMARK_STYLE = {
    filePath: "",
    widthPx: 180,
    x: 1680,
    y: 40,
    opacity: 0.82,
    fadeMs: 200
};

const DEFAULT_OUTPUT_SETTINGS = {
    resolution: "1920x1080",
    fps: "29.97",
    scanMode: "progressive",
    aspectRatio: "16:9",
    pixelFormat: "yuv420p",

    audio: {
        sampleRate: 48000,
        channels: 2,
        bitrateKbps: 192,
        codec: "aac"
    },

    ndi: {
        enabled: true,
        name: "Santtos TV - PROGRAM"
    },

    srt: {
        enabled: false,
        mode: "caller",
        host: "127.0.0.1",
        port: 9000,
        latencyMs: 120,
        passphrase: "",
        streamId: "",
        videoCodec: "h264",
        videoBitrateKbps: 8000,
        maxBitrateKbps: 10000,
        gopSeconds: 2,
        preset: "veryfast",
        audioCodec: "aac",
        audioBitrateKbps: 192
    }
};

const initialData = {
    settings: {
        channelName: "Santtos TV",
        resolution: "1920x1080",
        fps: "59.94",
        ndiName: "Santtos TV Playout",
        output: structuredClone(DEFAULT_OUTPUT_SETTINGS),
        watermarkStyle: {
            ...DEFAULT_WATERMARK_STYLE
        },
        hashtagStyle: {
            ...DEFAULT_HASHTAG_STYLE
        }
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

function normalizeNumber(
    value,
    fallback,
    min,
    max
) {
    const numberValue = Number(value);

    if (!Number.isFinite(numberValue)) {
        return fallback;
    }

    return Math.min(
        max,
        Math.max(min, numberValue)
    );
}

function normalizeInteger(
    value,
    fallback,
    min,
    max
) {
    return Math.round(
        normalizeNumber(
            value,
            fallback,
            min,
            max
        )
    );
}

function normalizeChoice(
    value,
    allowed,
    fallback
) {
    return allowed.includes(value)
        ? value
        : fallback;
}

function normalizeText(
    value,
    fallback,
    maxLength
) {
    if (typeof value !== "string") {
        return fallback;
    }

    return value
        .trim()
        .slice(0, maxLength);
}

function normalizeHexColor(value, fallback) {
    if (
        typeof value === "string" &&
        /^#[0-9a-fA-F]{6}$/.test(value)
    ) {
        return value.toLowerCase();
    }

    return fallback;
}

function normalizeHashtagStyle(value = {}) {
    const allowedFonts = new Set([
        "Arial",
        "Segoe UI",
        "Tahoma",
        "Verdana",
        "Calibri"
    ]);

    return {
        fontFamily:
            allowedFonts.has(value.fontFamily)
                ? value.fontFamily
                : DEFAULT_HASHTAG_STYLE.fontFamily,

        fontSize: normalizeNumber(
            value.fontSize,
            DEFAULT_HASHTAG_STYLE.fontSize,
            10,
            160
        ),

        color: normalizeHexColor(
            value.color,
            DEFAULT_HASHTAG_STYLE.color
        ),

        opacity: normalizeNumber(
            value.opacity,
            DEFAULT_HASHTAG_STYLE.opacity,
            0,
            1
        ),

        x: normalizeNumber(
            value.x,
            DEFAULT_HASHTAG_STYLE.x,
            0,
            1920
        ),

        y: normalizeNumber(
            value.y,
            DEFAULT_HASHTAG_STYLE.y,
            0,
            1080
        ),

        bold:
            typeof value.bold === "boolean"
                ? value.bold
                : DEFAULT_HASHTAG_STYLE.bold,

        outlineWidth: normalizeNumber(
            value.outlineWidth,
            DEFAULT_HASHTAG_STYLE.outlineWidth,
            0,
            12
        ),

        outlineColor: normalizeHexColor(
            value.outlineColor,
            DEFAULT_HASHTAG_STYLE.outlineColor
        ),

        outlineOpacity: normalizeNumber(
            value.outlineOpacity,
            DEFAULT_HASHTAG_STYLE.outlineOpacity,
            0,
            1
        ),

        shadowEnabled:
            typeof value.shadowEnabled === "boolean"
                ? value.shadowEnabled
                : DEFAULT_HASHTAG_STYLE.shadowEnabled,

        shadowColor: normalizeHexColor(
            value.shadowColor,
            DEFAULT_HASHTAG_STYLE.shadowColor
        ),

        shadowOpacity: normalizeNumber(
            value.shadowOpacity,
            DEFAULT_HASHTAG_STYLE.shadowOpacity,
            0,
            1
        ),

        shadowX: normalizeNumber(
            value.shadowX,
            DEFAULT_HASHTAG_STYLE.shadowX,
            -30,
            30
        ),

        shadowY: normalizeNumber(
            value.shadowY,
            DEFAULT_HASHTAG_STYLE.shadowY,
            -30,
            30
        )
    };
}

function normalizeWatermarkStyle(value = {}) {
    return {
        filePath: normalizeText(value.filePath, "", 4096),
        widthPx: normalizeInteger(value.widthPx, 180, 24, 960),
        x: normalizeInteger(value.x, 1680, 0, 1920),
        y: normalizeInteger(value.y, 40, 0, 1080),
        opacity: normalizeNumber(value.opacity, 0.82, 0, 1),
        fadeMs: normalizeInteger(value.fadeMs, 200, 0, 2000)
    };
}

function normalizeOutputSettings(value = {}) {
    const audio = value.audio ?? {};
    const ndi = value.ndi ?? {};
    const srt = value.srt ?? {};

    return {
        resolution: normalizeChoice(
            value.resolution,
            [
                "3840x2160",
                "1920x1080",
                "1280x720",
                "720x576",
                "720x480"
            ],
            DEFAULT_OUTPUT_SETTINGS.resolution
        ),

        fps: normalizeChoice(
            String(value.fps ?? ""),
            [
                "23.976",
                "24",
                "25",
                "29.97",
                "30",
                "50",
                "59.94",
                "60"
            ],
            DEFAULT_OUTPUT_SETTINGS.fps
        ),

        scanMode: normalizeChoice(
            value.scanMode,
            ["progressive", "interlaced"],
            DEFAULT_OUTPUT_SETTINGS.scanMode
        ),

        aspectRatio: normalizeChoice(
            value.aspectRatio,
            ["16:9", "4:3"],
            DEFAULT_OUTPUT_SETTINGS.aspectRatio
        ),

        pixelFormat: normalizeChoice(
            value.pixelFormat,
            ["yuv420p", "yuv422p", "bgra"],
            DEFAULT_OUTPUT_SETTINGS.pixelFormat
        ),

        audio: {
            sampleRate: normalizeChoice(
                Number(audio.sampleRate),
                [44100, 48000],
                DEFAULT_OUTPUT_SETTINGS.audio.sampleRate
            ),
            channels: normalizeChoice(
                Number(audio.channels),
                [1, 2],
                DEFAULT_OUTPUT_SETTINGS.audio.channels
            ),
            bitrateKbps: normalizeChoice(
                Number(audio.bitrateKbps),
                [96, 128, 160, 192, 256, 320],
                DEFAULT_OUTPUT_SETTINGS.audio.bitrateKbps
            ),
            codec: normalizeChoice(
                audio.codec,
                ["aac", "pcm_s16le"],
                DEFAULT_OUTPUT_SETTINGS.audio.codec
            )
        },

        ndi: {
            enabled:
                typeof ndi.enabled === "boolean"
                    ? ndi.enabled
                    : DEFAULT_OUTPUT_SETTINGS.ndi.enabled,
            name: normalizeText(
                ndi.name,
                DEFAULT_OUTPUT_SETTINGS.ndi.name,
                120
            ) || DEFAULT_OUTPUT_SETTINGS.ndi.name
        },

        srt: {
            enabled:
                typeof srt.enabled === "boolean"
                    ? srt.enabled
                    : DEFAULT_OUTPUT_SETTINGS.srt.enabled,
            mode: normalizeChoice(
                srt.mode,
                ["caller", "listener", "rendezvous"],
                DEFAULT_OUTPUT_SETTINGS.srt.mode
            ),
            host: normalizeText(
                srt.host,
                DEFAULT_OUTPUT_SETTINGS.srt.host,
                253
            ) || DEFAULT_OUTPUT_SETTINGS.srt.host,
            port: normalizeInteger(
                srt.port,
                DEFAULT_OUTPUT_SETTINGS.srt.port,
                1,
                65535
            ),
            latencyMs: normalizeInteger(
                srt.latencyMs,
                DEFAULT_OUTPUT_SETTINGS.srt.latencyMs,
                20,
                8000
            ),
            passphrase: normalizeText(
                srt.passphrase,
                "",
                79
            ),
            streamId: normalizeText(
                srt.streamId,
                "",
                512
            ),
            videoCodec: normalizeChoice(
                srt.videoCodec,
                ["h264", "hevc"],
                DEFAULT_OUTPUT_SETTINGS.srt.videoCodec
            ),
            videoBitrateKbps: normalizeInteger(
                srt.videoBitrateKbps,
                DEFAULT_OUTPUT_SETTINGS.srt.videoBitrateKbps,
                500,
                100000
            ),
            maxBitrateKbps: normalizeInteger(
                srt.maxBitrateKbps,
                DEFAULT_OUTPUT_SETTINGS.srt.maxBitrateKbps,
                500,
                120000
            ),
            gopSeconds: normalizeNumber(
                srt.gopSeconds,
                DEFAULT_OUTPUT_SETTINGS.srt.gopSeconds,
                0.5,
                10
            ),
            preset: normalizeChoice(
                srt.preset,
                [
                    "ultrafast",
                    "superfast",
                    "veryfast",
                    "faster",
                    "fast",
                    "medium"
                ],
                DEFAULT_OUTPUT_SETTINGS.srt.preset
            ),
            audioCodec: "aac",
            audioBitrateKbps: normalizeChoice(
                Number(srt.audioBitrateKbps),
                [96, 128, 160, 192, 256, 320],
                DEFAULT_OUTPUT_SETTINGS.srt.audioBitrateKbps
            )
        }
    };
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
        const parsedSettings =
            parsedData.settings ?? {};

        data = {
            ...structuredClone(initialData),
            ...parsedData,

            settings: {
                ...initialData.settings,
                ...parsedSettings,
                output:
                    normalizeOutputSettings(
                        parsedSettings.output
                    ),
                watermarkStyle:
                    normalizeWatermarkStyle(
                        parsedSettings.watermarkStyle
                    ),
                hashtagStyle:
                    normalizeHashtagStyle(
                        parsedSettings.hashtagStyle
                    )
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

function getSettings() {
    return structuredClone(data.settings);
}

function updateOutputSettings(output) {
    data.settings.output =
        normalizeOutputSettings(output);

    saveDatabase();

    return structuredClone(
        data.settings.output
    );
}

function updateWatermarkStyle(style) {
    data.settings.watermarkStyle =
        normalizeWatermarkStyle(style);

    saveDatabase();

    return structuredClone(
        data.settings.watermarkStyle
    );
}

function updateHashtagStyle(style) {
    data.settings.hashtagStyle =
        normalizeHashtagStyle(style);

    saveDatabase();

    return structuredClone(
        data.settings.hashtagStyle
    );
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
                watermark: Boolean(entry.watermark),
                inPoint: normalizeClipNumber(entry.inPoint, 0),
                outPoint: normalizeClipNumber(
                    entry.outPoint,
                    sourceMedia.duration ?? 0
                ),
                blockLabel: normalizeText(
                    entry.blockLabel,
                    "",
                    80
                ),
                hashtag:
                    normalizeHashtag(
                        entry.hashtag ?? ""
                    )
            };
        })
        .filter(Boolean);
}

function normalizeClipNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed)
        ? Math.max(0, parsed)
        : Math.max(0, Number(fallback) || 0);
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
                watermark: Boolean(item.watermark),
                inPoint: normalizeClipNumber(item.inPoint, 0),
                outPoint: normalizeClipNumber(
                    item.outPoint,
                    item.duration ?? 0
                ),
                blockLabel: normalizeText(
                    item.blockLabel,
                    "",
                    80
                ),
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

        const supportedContainers = new Set([
            "mp4",
            "mov",
            "mkv",
            "avi",
            "mxf",
            "ts",
            "mts",
            "m2ts",
            "webm",
            "mpg",
            "mpeg",
            "m4v",
            "wmv"
        ]);

        if (!supportedContainers.has(extension)) {
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
    getSettings,
    updateOutputSettings,
    updateWatermarkStyle,
    updateHashtagStyle,
    addLog,
    getMedia,
    getTimeline,
    saveTimeline,
    addMedia,
    removeMedia,
    updateMediaMetadata
};
