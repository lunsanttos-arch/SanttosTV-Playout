"use strict";

const {
    DEFAULT_BROWSER_USER_AGENT,
    resolveHttpIdentity
} = require("./remote-input");

function dailymotionVideoId(value) {
    if (typeof value !== "string" || !value.trim()) {
        return null;
    }

    let parsed;

    try {
        parsed =
            new URL(
                value.trim()
            );
    } catch {
        return null;
    }

    const host =
        parsed.hostname
            .toLowerCase();

    const isDailymotion =
        host === "dailymotion.com" ||
        host.endsWith(".dailymotion.com");
    const isDmcdn =
        host === "dmcdn.net" ||
        host.endsWith(".dmcdn.net");

    if (!isDailymotion && !isDmcdn) {
        return null;
    }

    const path =
        decodeURIComponent(
            parsed.pathname
        );

    const patterns =
        isDailymotion
            ? [
                  /\/video\/([a-z0-9]+)/i,
                  /\/embed\/video\/([a-z0-9]+)/i,
                  /\/player\/[^/]+\/video\/([a-z0-9]+)/i,
                  /\/cdn\/live\/video\/([a-z0-9]+)\.m3u8/i
              ]
            : [
                  /\/([a-z0-9]{5,})\.m3u8/i
              ];

    for (const pattern of patterns) {
        const match =
            path.match(
                pattern
            );

        if (match?.[1]) {
            return match[1];
        }
    }

    return null;
}

function chooseDailymotionSource(metadata) {
    const qualities =
        metadata &&
        typeof metadata === "object" &&
        metadata.qualities &&
        typeof metadata.qualities === "object"
            ? metadata.qualities
            : null;

    if (!qualities) return null;

    const orderedKeys = [
        "auto",
        "1080",
        "720",
        "480",
        "380",
        "360",
        "240",
        "144"
    ];

    for (const key of orderedKeys) {
        const sources =
            Array.isArray(qualities[key])
                ? qualities[key]
                : [];

        const hls =
            sources.find(
                (entry) =>
                    entry &&
                    typeof entry.url === "string" &&
                    /(?:mpegurl|m3u8)/i.test(
                        String(
                            entry.type || entry.url
                        )
                    )
            );

        if (hls?.url) {
            return hls.url;
        }
    }

    for (const key of Object.keys(qualities)) {
        const sources =
            Array.isArray(qualities[key])
                ? qualities[key]
                : [];

        const any =
            sources.find(
                (entry) =>
                    entry &&
                    typeof entry.url === "string" &&
                    /^https?:\/\//i.test(
                        entry.url
                    )
            );

        if (any?.url) {
            return any.url;
        }
    }

    return null;
}

function cookieHeaderFromResponse(response) {
    const headers = response?.headers;
    if (!headers) return "";

    const getSetCookie =
        typeof headers.getSetCookie === "function"
            ? headers.getSetCookie.bind(headers)
            : null;

    const values =
        getSetCookie
            ? getSetCookie()
            : [];

    if (!Array.isArray(values) || values.length === 0) {
        return "";
    }

    return values
        .map((value) =>
            String(value)
                .split(";")[0]
                .trim()
        )
        .filter(Boolean)
        .join("; ");
}

async function resolveDailymotionInput(
    originalUrl,
    {
        fetchImpl = globalThis.fetch,
        userAgent = "",
        referer = "",
        timeoutMs = 8000
    } = {}
) {
    const videoId =
        dailymotionVideoId(
            originalUrl
        );

    if (!videoId) {
        return null;
    }

    if (typeof fetchImpl !== "function") {
        throw new Error(
            "O runtime não possui suporte HTTP para renovar o Input Dailymotion."
        );
    }

    const identity =
        resolveHttpIdentity(
            originalUrl,
            {
                userAgent,
                referer
            }
        );

    const controller =
        new AbortController();
    const timeout =
        setTimeout(
            () => controller.abort(),
            Math.max(
                1500,
                Number(timeoutMs) || 8000
            )
        );

    try {
        const response =
            await fetchImpl(
                `https://www.dailymotion.com/player/metadata/video/${encodeURIComponent(videoId)}`,
                {
                    method: "GET",
                    redirect: "follow",
                    signal:
                        controller.signal,
                    headers: {
                        "Accept":
                            "application/json,text/plain,*/*",
                        "User-Agent":
                            identity.userAgent ||
                            DEFAULT_BROWSER_USER_AGENT,
                        "Referer":
                            identity.referer ||
                            "https://www.dailymotion.com/"
                    }
                }
            );

        if (!response.ok) {
            throw new Error(
                `Dailymotion metadata HTTP ${response.status}.`
            );
        }

        const metadata =
            await response.json();

        const url =
            chooseDailymotionSource(
                metadata
            );

        if (!url) {
            const message =
                typeof metadata?.error?.title === "string"
                    ? metadata.error.title
                    : "O Dailymotion não retornou uma fonte HLS reproduzível.";

            throw new Error(
                message
            );
        }

        return {
            provider:
                "dailymotion",
            providerId:
                videoId,
            url,
            userAgent:
                identity.userAgent,
            referer:
                identity.referer ||
                "https://www.dailymotion.com/",
            cookie:
                cookieHeaderFromResponse(
                    response
                )
        };
    } catch (error) {
        if (
            error?.name ===
            "AbortError"
        ) {
            throw new Error(
                "Tempo esgotado ao renovar o Input Dailymotion."
            );
        }

        throw error;
    } finally {
        clearTimeout(
            timeout
        );
    }
}

async function resolveRemoteInput(
    originalUrl,
    options = {}
) {
    const daily =
        await resolveDailymotionInput(
            originalUrl,
            options
        );

    if (daily) {
        return daily;
    }

    const identity =
        resolveHttpIdentity(
            originalUrl,
            options
        );

    return {
        provider:
            "direct",
        providerId:
            null,
        url:
            originalUrl,
        userAgent:
            identity.userAgent,
        referer:
            identity.referer,
        cookie:
            ""
    };
}

module.exports = {
    dailymotionVideoId,
    chooseDailymotionSource,
    resolveDailymotionInput,
    resolveRemoteInput
};
