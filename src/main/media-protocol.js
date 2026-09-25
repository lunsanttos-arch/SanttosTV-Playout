"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");

const MEDIA_SCHEME = "santtos-media";
const MAX_MEDIA_PATH_LENGTH = 4096;
const MIME = {
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
    ".avi": "video/x-msvideo",
    ".mxf": "application/mxf",
    ".ts": "video/mp2t",
    ".mts": "video/mp2t",
    ".m2ts": "video/mp2t",
    ".mpg": "video/mpeg",
    ".mpeg": "video/mpeg",
    ".wmv": "video/x-ms-wmv"
};

function mediaUrl(filePath) {
    if (typeof filePath !== "string" || !filePath || filePath.length > MAX_MEDIA_PATH_LENGTH) {
        return "";
    }
    return `${MEDIA_SCHEME}://media/${encodeURIComponent(filePath)}`;
}

function decodeMediaUrl(urlValue) {
    try {
        const url = new URL(urlValue);
        if (url.protocol !== MEDIA_SCHEME + ":" || url.host !== "media" || url.search || url.hash) return null;
        const encoded = url.pathname.slice(1);
        if (!encoded || encoded.length > MAX_MEDIA_PATH_LENGTH * 4 || encoded.includes("/")) return null;
        const decoded = decodeURIComponent(encoded);
        if (!decoded || decoded.length > MAX_MEDIA_PATH_LENGTH || decoded.includes("\\0")) return null;
        return decoded;
    } catch {
        return null;
    }
}

function parseRange(value, length) {
    if (typeof value !== "string" || !/^bytes=\d*-\d*$/.test(value)) return null;
    const [startText, endText] = value.slice(6).split("-");
    if (!startText && !endText) return null;
    if (!startText) {
        const suffix = Number(endText);
        if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
        return { start: Math.max(0, length - suffix), end: length - 1 };
    }
    const start = Number(startText);
    const end = endText ? Number(endText) : length - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
        start >= length || end < start) return null;
    return { start, end: Math.min(end, length - 1) };
}

function createMediaProtocolHandler(getMedia) {
    if (typeof getMedia !== "function") throw new TypeError("getMedia must be a function");
    return function handleMediaRequest(request) {
        const requestedPath = decodeMediaUrl(request?.url);
        if (!requestedPath || !["GET", "HEAD"].includes(request?.method)) {
            return new Response(null, { status: 403 });
        }

        // Renderer knows the path but cannot use the scheme to read arbitrary PC files.
        // Only files explicitly imported into the operational library are exposed.
        let authorized = false;
        try {
            const target = fs.realpathSync.native(requestedPath);
            authorized = getMedia().some((item) =>
                typeof item.path === "string" &&
                fs.existsSync(item.path) &&
                fs.realpathSync.native(item.path) === target
            );
            if (!authorized) return new Response(null, { status: 403 });
            const stats = fs.statSync(target);
            if (!stats.isFile()) return new Response(null, { status: 403 });
            const headers = new Headers({
                "Accept-Ranges": "bytes",
                "Content-Type": MIME[path.extname(target).toLowerCase()] || "application/octet-stream",
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "no-store"
            });

            const rangeHeader = request.headers?.get?.("range");
            const range = rangeHeader ? parseRange(rangeHeader, stats.size) : null;
            if (rangeHeader && !range) {
                headers.set("Content-Range", `bytes */${stats.size}`);
                return new Response(null, { status: 416, headers });
            }

            const start = range ? range.start : 0;
            const end = range ? range.end : stats.size - 1;
            headers.set("Content-Length", String(Math.max(0, end - start + 1)));
            if (range) headers.set("Content-Range", `bytes ${start}-${end}/${stats.size}`);
            const status = range ? 206 : 200;
            if (request.method === "HEAD" || stats.size === 0) {
                return new Response(null, { status, headers });
            }
            const stream = fs.createReadStream(target, { start, end });
            return new Response(Readable.toWeb(stream), {
                status,
                headers,
                duplex: "half"
            });
        } catch {
            return new Response(null, { status: authorized ? 404 : 403 });
        }
    };
}

module.exports = {
    MEDIA_SCHEME,
    mediaUrl,
    decodeMediaUrl,
    parseRange,
    createMediaProtocolHandler
};
