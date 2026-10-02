"use strict";

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

function remoteInputArgs(
    url,
    {
        protocolHint = "",
        realtime = true,
        startupTimeoutUs = 15000000
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
            "SanttosTV-Playout/0.3",
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

        if (isHlsInput(url, protocolHint)) {
            args.push(
                "-allowed_extensions",
                "ALL"
            );
        }
    }

    return args;
}

module.exports = {
    normalizeProtocolHint,
    isRemoteInputUrl,
    isHttpInput,
    isHlsInput,
    remoteInputArgs
};
