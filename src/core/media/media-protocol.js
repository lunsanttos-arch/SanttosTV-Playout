"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");

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

function resolveMediaRequest(requestUrl, mediaItems, authorizedProxies = new Set()) {
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
        return permitted || authorizedProxies.has(realRequestedPath) ? realRequestedPath : null;
    } catch {
        return null;
    }
}

const MEDIA_TYPES = {
    ".mp4": "video/mp4", ".m4v": "video/mp4",
    ".mov": "video/quicktime", ".mkv": "video/x-matroska",
    ".webm": "video/webm", ".avi": "video/x-msvideo",
    ".ts": "video/mp2t", ".mts": "video/mp2t",
    ".m2ts": "video/mp2t", ".mxf": "application/mxf",
    ".wmv": "video/x-ms-wmv", ".mpg": "video/mpeg",
    ".mpeg": "video/mpeg"
};

/**
 * Chromium seeks through HTTP byte requests. net.fetch(file://) does not
 * reliably propagate Range to local files on Windows, so expose explicit
 * partial content and never expose any path outside the imported library.
 */
function parseByteRange(rangeHeader, size) {
    if (!Number.isSafeInteger(size) || size < 1) return null;
    if (!rangeHeader) return { start: 0, end: size - 1, partial: false };
    if (typeof rangeHeader !== "string" ||
        !/^bytes=(\d*)-(\d*)$/i.test(rangeHeader.trim())) return null;

    const [, first, last] = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
    if (!first && !last) return null;
    let start;
    let end;
    if (!first) {
        const suffix = Number(last);
        if (!Number.isSafeInteger(suffix) || suffix < 1) return null;
        start = Math.max(0, size - suffix);
        end = size - 1;
    } else {
        start = Number(first);
        end = last ? Math.min(size - 1, Number(last)) : size - 1;
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
        start >= size || end < start) return null;
    return { start, end, partial: true };
}

function serveImportedVideo(request, mediaItems, authorizedProxies = new Set()) {
    const allowedPath = resolveMediaRequest(request.url, mediaItems, authorizedProxies);
    if (!allowedPath) return new Response("Midia nao autorizada ou ausente", { status: 404 });
    let stat;
    try { stat = fs.statSync(allowedPath); } catch { return new Response("Arquivo indisponivel", { status: 404 }); }
    if (!stat.isFile() || stat.size < 1) return new Response("Arquivo vazio", { status: 404 });
    const range = parseByteRange(request.headers.get("range"), stat.size);
    const headers = new Headers({
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "Content-Type": MEDIA_TYPES[path.extname(allowedPath).toLowerCase()] || "application/octet-stream",
        "X-Content-Type-Options": "nosniff"
    });
    if (!range) {
        headers.set("Content-Range", `bytes */${stat.size}`);
        return new Response(null, { status: 416, headers });
    }
    headers.set("Content-Length", String(range.end - range.start + 1));
    if (range.partial) {
        headers.set("Content-Range", `bytes ${range.start}-${range.end}/${stat.size}`);
    }
    const status = range.partial ? 206 : 200;
    if (request.method === "HEAD") return new Response(null, { status, headers });
    if (request.method !== "GET") return new Response(null, { status: 405 });
    const stream = fs.createReadStream(allowedPath, {
        start: range.start,
        end: range.end,
        highWaterMark: 256 * 1024
    });
    request.signal?.addEventListener("abort", () => stream.destroy(), { once: true });
    return new Response(Readable.toWeb(stream), { status, headers });
}

module.exports = {
    MEDIA_SCHEME,
    buildMediaUrl,
    resolveMediaRequest,
    parseByteRange,
    serveImportedVideo
};
