"use strict";

const http = require("node:http");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");

function parseCookieHeader(raw) {
    const jar = new Map();

    String(raw || "")
        .split(";")
        .map(part => part.trim())
        .filter(Boolean)
        .forEach(part => {
            const index = part.indexOf("=");
            if (index <= 0) return;
            const name = part.slice(0, index).trim();
            const value = part.slice(index + 1).trim();
            if (name) jar.set(name, value);
        });

    return jar;
}

function mergeSetCookies(jar, headers) {
    if (!headers) return;

    let values = [];

    if (typeof headers.getSetCookie === "function") {
        values = headers.getSetCookie();
    } else {
        const single = headers.get("set-cookie");
        if (single) values = [single];
    }

    for (const raw of values || []) {
        const first = String(raw || "").split(";")[0];
        const index = first.indexOf("=");
        if (index <= 0) continue;

        const name = first.slice(0, index).trim();
        const value = first.slice(index + 1).trim();

        if (!name) continue;

        if (!value) {
            jar.delete(name);
        } else {
            jar.set(name, value);
        }
    }
}

function cookieHeader(jar) {
    return [...jar.entries()]
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
}

function isManifestResponse(upstreamUrl, contentType) {
    try {
        const pathname = new URL(upstreamUrl).pathname.toLowerCase();
        if (pathname.endsWith(".m3u8")) return true;
    } catch {
        // URL já foi validada antes.
    }

    return /(?:mpegurl|application\/vnd\.apple\.mpegurl)/i.test(
        String(contentType || "")
    );
}

function rewriteManifest(text, baseUrl, localUrlFor) {
    const rewrite = (raw) => {
        const value = String(raw || "").trim();
        if (!value) return value;

        try {
            return localUrlFor(
                new URL(value, baseUrl).toString()
            );
        } catch {
            return value;
        }
    };

    return String(text || "")
        .split(/\r?\n/)
        .map(line => {
            if (!line.trim()) return line;

            if (line.startsWith("#")) {
                return line.replace(
                    /URI="([^"]+)"/g,
                    (_all, uri) =>
                        `URI="${rewrite(uri)}"`
                );
            }

            return rewrite(line);
        })
        .join("\n");
}

function safeRemoteUrl(raw) {
    let parsed;

    try {
        parsed = new URL(raw);
    } catch {
        return null;
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
        return null;
    }

    const host = parsed.hostname.toLowerCase();

    if (
        host === "localhost" ||
        host === "::1" ||
        host.endsWith(".local") ||
        /^127\./.test(host) ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^169\.254\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
        return null;
    }

    return parsed.toString();
}

async function createRemoteHlsProxy(
    resolved,
    {
        fetchImpl = globalThis.fetch,
        timeoutMs = 15000
    } = {}
) {
    if (
        !resolved ||
        typeof resolved.url !== "string" ||
        typeof fetchImpl !== "function"
    ) {
        throw new Error(
            "Não foi possível iniciar o proxy interno do Input."
        );
    }

    const firstUrl = safeRemoteUrl(resolved.url);
    if (!firstUrl) {
        throw new Error(
            "A origem HTTP do Input não é válida para o proxy interno."
        );
    }

    const token = crypto.randomBytes(24).toString("hex");
    const jar = parseCookieHeader(resolved.cookie);
    const userAgent = String(resolved.userAgent || "").trim();
    const referer = String(resolved.referer || "").trim();

    let localBase = "";

    const localUrlFor = upstreamUrl =>
        `${localBase}/fetch/${token}?u=${encodeURIComponent(upstreamUrl)}`;

    const server = http.createServer(async (request, response) => {
        const abort = new AbortController();

        request.on("close", () => {
            if (!response.writableEnded) {
                abort.abort();
            }
        });

        try {
            const requestUrl = new URL(
                request.url || "/",
                "http://127.0.0.1"
            );

            if (
                requestUrl.pathname !== `/fetch/${token}` ||
                !["GET", "HEAD"].includes(request.method || "GET")
            ) {
                response.writeHead(404);
                response.end();
                return;
            }

            const upstream =
                safeRemoteUrl(
                    requestUrl.searchParams.get("u") || ""
                );

            if (!upstream) {
                response.writeHead(400);
                response.end("Origem inválida.");
                return;
            }

            const headers = {
                "Accept": "*/*",
                "Accept-Encoding": "identity"
            };

            if (userAgent) {
                headers["User-Agent"] = userAgent;
            }

            if (referer) {
                headers["Referer"] = referer;

                try {
                    headers["Origin"] = new URL(referer).origin;
                } catch {
                    // Referer já foi sanitizado pelo cadastro.
                }
            }

            const cookies = cookieHeader(jar);
            if (cookies) {
                headers["Cookie"] = cookies;
            }

            if (request.headers.range) {
                headers["Range"] =
                    String(request.headers.range);
            }

            const controllerTimeout =
                setTimeout(
                    () => abort.abort(),
                    Math.max(
                        2500,
                        Number(timeoutMs) || 15000
                    )
                );

            let upstreamResponse;

            try {
                upstreamResponse = await fetchImpl(
                    upstream,
                    {
                        method:
                            request.method || "GET",
                        redirect:
                            "follow",
                        headers,
                        signal:
                            abort.signal
                    }
                );
            } finally {
                clearTimeout(controllerTimeout);
            }

            mergeSetCookies(
                jar,
                upstreamResponse.headers
            );

            const contentType =
                upstreamResponse.headers.get(
                    "content-type"
                ) || "";

            if (!upstreamResponse.ok) {
                const body =
                    request.method === "HEAD"
                        ? ""
                        : (
                              await upstreamResponse.text()
                          ).slice(0, 600);

                response.writeHead(
                    upstreamResponse.status,
                    {
                        "Content-Type":
                            "text/plain; charset=utf-8",
                        "Cache-Control":
                            "no-store"
                    }
                );
                response.end(
                    body ||
                    `Upstream HTTP ${upstreamResponse.status}`
                );
                return;
            }

            if (
                request.method !== "HEAD" &&
                isManifestResponse(
                    upstreamResponse.url || upstream,
                    contentType
                )
            ) {
                const text =
                    await upstreamResponse.text();

                const rewritten =
                    rewriteManifest(
                        text,
                        upstreamResponse.url || upstream,
                        localUrlFor
                    );

                response.writeHead(
                    upstreamResponse.status,
                    {
                        "Content-Type":
                            "application/vnd.apple.mpegurl",
                        "Cache-Control":
                            "no-store, no-cache, must-revalidate",
                        "Content-Length":
                            Buffer.byteLength(
                                rewritten
                            )
                    }
                );
                response.end(rewritten);
                return;
            }

            const responseHeaders = {
                "Content-Type":
                    contentType ||
                    "application/octet-stream",
                "Cache-Control":
                    "no-store"
            };

            const contentLength =
                upstreamResponse.headers.get(
                    "content-length"
                );
            const contentRange =
                upstreamResponse.headers.get(
                    "content-range"
                );
            const acceptRanges =
                upstreamResponse.headers.get(
                    "accept-ranges"
                );

            if (contentLength) {
                responseHeaders["Content-Length"] =
                    contentLength;
            }
            if (contentRange) {
                responseHeaders["Content-Range"] =
                    contentRange;
            }
            if (acceptRanges) {
                responseHeaders["Accept-Ranges"] =
                    acceptRanges;
            }

            response.writeHead(
                upstreamResponse.status,
                responseHeaders
            );

            if (
                request.method === "HEAD" ||
                !upstreamResponse.body
            ) {
                response.end();
                return;
            }

            Readable.fromWeb(
                upstreamResponse.body
            )
                .on("error", error => {
                    if (!response.destroyed) {
                        response.destroy(error);
                    }
                })
                .pipe(response);
        } catch (error) {
            if (
                error?.name === "AbortError" ||
                response.destroyed
            ) {
                return;
            }

            console.error(
                "Falha no proxy interno do Input:",
                error
            );

            if (!response.headersSent) {
                response.writeHead(
                    502,
                    {
                        "Content-Type":
                            "text/plain; charset=utf-8",
                        "Cache-Control":
                            "no-store"
                    }
                );
            }

            if (!response.writableEnded) {
                response.end(
                    String(
                        error?.message ||
                        "Falha no proxy do Input."
                    )
                );
            }
        }
    });

    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(
            0,
            "127.0.0.1",
            () => {
                server.off("error", reject);
                resolve();
            }
        );
    });

    const address = server.address();

    if (
        !address ||
        typeof address !== "object"
    ) {
        server.close();
        throw new Error(
            "O proxy interno do Input não recebeu uma porta local."
        );
    }

    localBase =
        `http://127.0.0.1:${address.port}`;

    let closed = false;

    return {
        url:
            localUrlFor(firstUrl),
        port:
            address.port,
        close() {
            if (closed) return;
            closed = true;

            try {
                server.close();
            } catch {
                // Servidor já encerrado.
            }
        }
    };
}

module.exports = {
    parseCookieHeader,
    mergeSetCookies,
    rewriteManifest,
    createRemoteHlsProxy
};
