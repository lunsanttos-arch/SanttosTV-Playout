"use strict";

const DEFAULT_BROWSER_USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/154.0.0.0 Safari/537.36";

function normalizeProtocolHint(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    return ["http", "https", "hls", "m3u8", "srt"].includes(normalized)
        ? normalized
        : "";
}

function isRemoteInputUrl(value) {
    return typeof value === "string" &&
        /^(https?:\/\/|srt:\/\/)/i.test(value.trim());
}

function isHttpInput(value) {
    return typeof value === "string" &&
        /^https?:\/\//i.test(value.trim());
}

function isHlsInput(value, protocolHint = "") {
    const hint = normalizeProtocolHint(protocolHint);
    if (hint === "hls" || hint === "m3u8") return true;

    return typeof value === "string" &&
        /\.m3u8(?:[?#]|$)/i.test(value.trim());
}

function cleanHeaderValue(value, maxLength) {
    return typeof value === "string"
        ? value
            .replace(/[\r\n\u0000]/g, "")
            .trim()
            .slice(0, maxLength)
        : "";
}

function automaticReferer(url) {
    if (typeof url !== "string") return "";

    try {
        const host =
            new URL(url).hostname.toLowerCase();

        if (
            host === "dailymotion.com" ||
            host.endsWith(".dailymotion.com")
        ) {
            return "https://www.dailymotion.com/";
        }
    } catch {
        // URL inválida será rejeitada em remoteInputArgs.
    }

    return "";
}

function resolveHttpIdentity(
    url,
    {
        userAgent = "",
        referer = "",
        cookie = ""
    } = {}
) {
    const explicitUserAgent =
        cleanHeaderValue(
            userAgent,
            512
        );
    const explicitReferer =
        cleanHeaderValue(
            referer,
            2048
        );

    return {
        userAgent:
            explicitUserAgent ||
            DEFAULT_BROWSER_USER_AGENT,
        referer:
            explicitReferer ||
            automaticReferer(url)
    };
}

function describeRemoteInputError(stderr) {
    const message =
        String(stderr ?? "")
            .replace(/\s+/g, " ")
            .trim();

    if (
        /\b403\b|forbidden|access denied/i.test(
            message
        )
    ) {
        return (
            "HTTP 403: o servidor recusou o Input. " +
            "Esse endereço pode exigir Referer/User-Agent de navegador " +
            "ou pode ser um link temporário/assinado que já expirou."
        );
    }

    if (
        /\b401\b|unauthorized/i.test(
            message
        )
    ) {
        return (
            "HTTP 401: o servidor exige autenticação para abrir este Input."
        );
    }

    if (
        /404|not found/i.test(
            message
        )
    ) {
        return (
            "HTTP 404: o endereço do Input não foi encontrado."
        );
    }

    return message;
}

function remoteInputArgs(
    url,
    {
        protocolHint = "",
        realtime = true,
        startupTimeoutUs = 15000000,
        userAgent = "",
        referer = "",
        cookie = ""
    } = {}
) {
    if (!isRemoteInputUrl(url)) {
        throw new Error("URL de Input remoto inválida.");
    }

    const args = [
        "-thread_queue_size",
        "1024"
    ];

    if (isHttpInput(url)) {
        const identity =
            resolveHttpIdentity(
                url,
                {
                    userAgent,
                    referer
                }
            );

        args.push(
            "-rw_timeout",
            String(
                Math.max(
                    1000000,
                    Math.round(
                        Number(startupTimeoutUs) ||
                        15000000
                    )
                )
            ),
            "-user_agent",
            identity.userAgent
        );

        if (identity.referer) {
            args.push(
                "-referer",
                identity.referer
            );
        }

        const safeCookie =
            typeof cookie === "string"
                ? cookie
                    .replace(/[\r\n\u0000]/g, "")
                    .trim()
                    .slice(0, 4096)
                : "";

        if (safeCookie) {
            args.push(
                "-headers",
                `Cookie: ${safeCookie}\r\n`
            );
        }

        args.push(
            "-reconnect",
            "1",
            "-reconnect_streamed",
            "1",
            "-reconnect_delay_max",
            "4"
        );

        // HLS VOD de teste e MP4 HTTP podem chegar mais rápido que o relógio.
        // -re mantém o Input em tempo real. Em uma fonte realmente live ele
        // não acelera nem muda a cadência recebida.
        if (realtime) {
            args.push("-re");
        }
    }

    return args;
}

module.exports = {
    DEFAULT_BROWSER_USER_AGENT,
    normalizeProtocolHint,
    isRemoteInputUrl,
    isHttpInput,
    isHlsInput,
    automaticReferer,
    resolveHttpIdentity,
    describeRemoteInputError,
    remoteInputArgs
};
