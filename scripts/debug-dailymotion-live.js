"use strict";

const { spawn } = require("node:child_process");
const ffmpegStatic = require("ffmpeg-static");
const {
    resolveRemoteInput
} = require("../src/core/playout/remote-input-resolver");
const {
    remoteInputArgs
} = require("../src/core/playout/remote-input");

function ffmpegPath() {
    if (typeof ffmpegStatic !== "string" || !ffmpegStatic) {
        throw new Error("ffmpeg-static indisponível.");
    }
    return ffmpegStatic.replace("app.asar", "app.asar.unpacked");
}

function safeUrlSummary(raw) {
    try {
        const url = new URL(raw);
        return {
            protocol: url.protocol,
            host: url.hostname,
            pathname: url.pathname,
            queryKeys: [...url.searchParams.keys()]
        };
    } catch {
        return { invalid: true };
    }
}

function cookieNames(raw) {
    return String(raw || "")
        .split(";")
        .map(v => v.trim().split("=")[0])
        .filter(Boolean);
}

function runFfmpeg(args, timeoutMs = 25000) {
    return new Promise((resolve, reject) => {
        const child = spawn(ffmpegPath(), args, {
            windowsHide: true,
            stdio: ["ignore", "ignore", "pipe"]
        });

        let stderr = "";
        let settled = false;

        child.stderr.on("data", chunk => {
            stderr = (stderr + chunk.toString()).slice(-12000);
        });

        child.on("error", error => {
            if (settled) return;
            settled = true;
            reject(error);
        });

        const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            try { child.kill(); } catch {}
            reject(new Error("Timeout FFmpeg.\n" + stderr));
        }, timeoutMs);

        child.on("exit", (code, signal) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (code === 0 && !signal) {
                resolve({ code, signal, stderr });
                return;
            }
            reject(new Error(
                `FFmpeg code=${code} signal=${signal || "-"}\n${stderr}`
            ));
        });
    });
}

async function main() {
    const original =
        "https://cdndirector.dailymotion.com/cdn/live/video/x9xwtpy.m3u8?sec=expired";

    const resolved = await resolveRemoteInput(original);

    console.log("RESOLVER", {
        provider: resolved.provider,
        providerId: resolved.providerId,
        url: safeUrlSummary(resolved.url),
        referer: resolved.referer,
        userAgentPrefix: String(resolved.userAgent || "").slice(0, 40),
        cookieNames: cookieNames(resolved.cookie)
    });

    const args = [
        "-hide_banner",
        "-loglevel",
        "verbose",
        "-nostdin",
        "-fflags",
        "+genpts+discardcorrupt",
        ...remoteInputArgs(resolved.url, {
            protocolHint: "hls",
            userAgent: resolved.userAgent,
            referer: resolved.referer,
            cookie: resolved.cookie,
            realtime: false
        }),
        "-i",
        resolved.url,
        "-t",
        "5",
        "-map",
        "0:v:0",
        "-an",
        "-f",
        "null",
        "-"
    ];

    const result = await runFfmpeg(args);
    console.log("Dailymotion live decode OK");
    console.log(result.stderr.slice(-2000));
}

main().catch(error => {
    console.error("Dailymotion live decode FAILED");
    console.error(String(error?.stack || error));
    process.exitCode = 1;
});
