"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MEDIA_SCHEME = "santtos-media";
const VIDEO_EXTENSIONS = new Set([
    ".mp4", ".mov", ".mkv", ".avi", ".mxf", ".ts",
    ".mts", ".m2ts", ".webm", ".mpg", ".mpeg", ".m4v", ".wmv"
]);

function buildMediaUrl(filePath) {
    if (typeof filePath !== "string" || !path.isAbsolute(filePath) ||
        filePath.length > 4096 || filePath.includes("\0")) {
        return "";
    }
    return `${MEDIA_SCHEME}://local/video?path=${encodeURIComponent(filePath)}`;
}

function resolveMediaRequest(requestUrl, mediaItems) {
    let requestedUrl;
    try {
        requestedUrl = new URL(requestUrl);
    } catch {
        return null;
    }
    if (requestedUrl.protocol !== `${MEDIA_SCHEME}:` ||
        requestedUrl.hostname !== "local" ||
        requestedUrl.pathname !== "/video" ||
        requestedUrl.searchParams.size !== 1) {
        return null;
    }

    const requestedPath = requestedUrl.searchParams.get("path");
    if (!requestedPath || !path.isAbsolute(requestedPath) ||
        requestedPath.length > 4096 || requestedPath.includes("\0") ||
        !VIDEO_EXTENSIONS.has(path.extname(requestedPath).toLowerCase())) {
        return null;
    }

    try {
        const realRequestedPath = fs.realpathSync(requestedPath);
        if (!fs.statSync(realRequestedPath).isFile()) return null;

        // O protocolo nunca deve funcionar como leitor de arquivos do disco:
        // so pode servir midia explicitamente importada para a biblioteca.
        const permitted = Array.isArray(mediaItems) && mediaItems.some((media) => {
            if (typeof media?.path !== "string") return false;
            try {
                return fs.realpathSync(media.path) === realRequestedPath;
            } catch {
                return false;
            }
        });
        return permitted ? realRequestedPath : null;
    } catch {
        return null;
    }
}

module.exports = { MEDIA_SCHEME, buildMediaUrl, resolveMediaRequest };
