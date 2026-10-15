const { openJsonStore } = require("../persistence/json-store");
let configStore = null;
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let configFile = "";
let inputs = [];

function ensureFolder(folderPath) {
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, {
            recursive: true
        });
    }
}

function normalizeProtocol(value, url) {
    const explicit = String(
        value ?? ""
    ).toLowerCase();

    if (
        ["http", "https", "hls", "m3u8", "srt", "rtmp", "rtmps"].includes(
            explicit
        )
    ) {
        return explicit;
    }

    const source =
        String(url ?? "")
            .trim()
            .toLowerCase();

    if (/^rtmps?:\/\//.test(source)) return source.startsWith("rtmps:") ? "rtmps" : "rtmp";

    if (source.startsWith("srt://")) {
        return "srt";
    }

    if (
        source.includes(".m3u8") ||
        source.startsWith("hls://")
    ) {
        return "hls";
    }

    if (source.startsWith("https://")) {
        return "https";
    }

    return "http";
}

function normalizeInput(value = {}) {
    const url =
        typeof value.url === "string"
            ? value.url.trim().slice(0, 4096)
            : "";

    const name =
        typeof value.name === "string"
            ? value.name.trim().slice(0, 120)
            : "";

    const timingMode =
        value.timingMode === "clock"
            ? "clock"
            : "duration";

    const durationSeconds =
        Math.max(
            1,
            Math.min(
                86400,
                Math.round(
                    Number(
                        value.durationSeconds
                    ) || 60
                )
            )
        );

    const endTime =
        /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(
            String(
                value.endTime ?? ""
            )
        )
            ? String(
                  value.endTime
              ).slice(0, 8)
            : "00:01:00";

    const fitMode =
        ["contain", "cover", "stretch"].includes(
            value.fitMode
        )
            ? value.fitMode
            : "contain";

    const sizePercent =
        Math.max(
            10,
            Math.min(
                100,
                Math.round(
                    Number(value.sizePercent) || 100
                )
            )
        );

    const httpReferer =
        typeof value.httpReferer === "string"
            ? value.httpReferer
                .replace(/[\r\n\u0000]/g, "")
                .trim()
                .slice(0, 2048)
            : "";

    const httpUserAgent =
        typeof value.httpUserAgent === "string"
            ? value.httpUserAgent
                .replace(/[\r\n\u0000]/g, "")
                .trim()
                .slice(0, 512)
            : "";

    const engine =
        ["auto", "ffmpeg", "vlc"].includes(
            String(value.engine ?? "").toLowerCase()
        )
            ? String(value.engine).toLowerCase()
            : "auto";

    return {
        id:
            typeof value.id === "string" &&
            value.id.trim()
                ? value.id.trim().slice(0, 160)
                : crypto.randomUUID(),
        name:
            name ||
            "Input Web",
        url,
        protocol:
            normalizeProtocol(
                value.protocol,
                url
            ),
        timingMode,
        durationSeconds,
        endTime,
        fitMode,
        sizePercent,
        httpReferer,
        httpUserAgent,
        engine,
        premiumFeature: true,
        createdAt:
            typeof value.createdAt === "string"
                ? value.createdAt
                : new Date().toISOString()
    };
}

function validateInput(input) {
    if (!input.url) {
        throw new Error(
            "Informe a URL do input."
        );
    }

    if (
        !/^(https?:\/\/|srt:\/\/|rtmps?:\/\/)/i.test(
            input.url
        )
    ) {
        throw new Error(
            "O input deve usar HTTP, HTTPS, HLS/M3U8, RTMP ou SRT."
        );
    }

    return input;
}

function saveConfig() {
    if (!configFile) return;
    configStore ??= openJsonStore(configFile, () => ({ inputs }));
    configStore.replace({ inputs });
}

function initializeWebInputs(userDataPath) {
    if (configStore?.dirty) throw Error("Aguarde a gravação da biblioteca antes de recarregar.");
    configStore = null;
    configFile = path.join(
        userDataPath,
        "web-inputs.json"
    );

    if (
        !fs.existsSync(
            configFile
        )
    ) {
        inputs = [];
        saveConfig();
        return;
    }

    try {
        const parsed =
            JSON.parse(
                fs.readFileSync(
                    configFile,
                    "utf8"
                )
            );

        inputs =
            Array.isArray(
                parsed?.inputs
            )
                ? parsed.inputs
                    .map(normalizeInput)
                    .filter(
                        (item) =>
                            item.url
                    )
                : [];
    } catch (error) {
        console.error(
            "Falha ao carregar inputs web:",
            error
        );
        inputs = [];
    }
    configStore ??= openJsonStore(configFile, () => ({ inputs }));
}

function getWebInputs() {
    return inputs.map(
        (item) => ({
            ...item
        })
    );
}

function saveWebInput(value) {
    const normalized =
        validateInput(
            normalizeInput(
                value
            )
        );

    const index =
        inputs.findIndex(
            (item) =>
                item.id ===
                normalized.id
        );

    if (index >= 0) {
        inputs[index] =
            normalized;
    } else {
        inputs.push(
            normalized
        );
    }

    saveConfig();

    return {
        ...normalized
    };
}

function removeWebInput(id) {
    const before =
        inputs.length;

    inputs =
        inputs.filter(
            (item) =>
                item.id !== id
        );

    if (
        inputs.length !== before
    ) {
        saveConfig();
    }

    return {
        removed:
            inputs.length !==
            before,
        inputs:
            getWebInputs()
    };
}

module.exports = {
    initializeWebInputs,
    getWebInputs,
    saveWebInput,
    removeWebInput
};
