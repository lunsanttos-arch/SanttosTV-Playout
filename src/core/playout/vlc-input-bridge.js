"use strict";

const fs = require("node:fs");
const path = require("node:path");
const dgram = require("node:dgram");
const { spawn, spawnSync } = require("node:child_process");

function cleanText(value, maxLength = 2048) {
    return typeof value === "string"
        ? value
            .replace(/[\r\n\u0000]/g, "")
            .trim()
            .slice(0, maxLength)
        : "";
}

function candidateVlcPaths(env = process.env) {
    const candidates = [];

    const explicit =
        cleanText(
            env.SANTTOS_VLC_PATH,
            4096
        );

    if (explicit) {
        candidates.push(explicit);
    }

    const programFiles =
        cleanText(
            env.ProgramFiles ||
            env.PROGRAMFILES,
            4096
        );
    const programFilesX86 =
        cleanText(
            env["ProgramFiles(x86)"] ||
            env.PROGRAMFILES_X86,
            4096
        );
    const localAppData =
        cleanText(
            env.LOCALAPPDATA,
            4096
        );

    for (const base of [
        programFiles,
        programFilesX86
    ]) {
        if (!base) continue;
        candidates.push(
            path.join(
                base,
                "VideoLAN",
                "VLC",
                "vlc.exe"
            )
        );
    }

    if (localAppData) {
        candidates.push(
            path.join(
                localAppData,
                "Programs",
                "VideoLAN",
                "VLC",
                "vlc.exe"
            )
        );
    }

    return [
        ...new Set(
            candidates
                .filter(Boolean)
        )
    ];
}

function findVlcPath({
    env = process.env,
    existsSync = fs.existsSync,
    spawnSyncImpl = spawnSync
} = {}) {
    for (const candidate of candidateVlcPaths(env)) {
        try {
            if (existsSync(candidate)) {
                return candidate;
            }
        } catch {
            // Continua procurando.
        }
    }

    try {
        const result =
            spawnSyncImpl(
                process.platform === "win32"
                    ? "where.exe"
                    : "which",
                ["vlc"],
                {
                    windowsHide: true,
                    encoding: "utf8",
                    timeout: 2500
                }
            );

        if (result?.status === 0) {
            const first =
                String(result.stdout || "")
                    .split(/\r?\n/)
                    .map(value => value.trim())
                    .find(Boolean);

            if (first) {
                return first;
            }
        }
    } catch {
        // VLC não está no PATH.
    }

    return null;
}

function selectInputEngine(
    preferred,
    provider,
    vlcAvailable
) {
    const normalized =
        ["auto", "ffmpeg", "vlc"].includes(
            String(preferred || "").toLowerCase()
        )
            ? String(preferred).toLowerCase()
            : "auto";

    if (normalized === "ffmpeg") {
        return "ffmpeg";
    }

    if (normalized === "vlc") {
        if (!vlcAvailable) {
            throw new Error(
                "Este Input está configurado para VLC, mas o VLC não foi encontrado no Windows."
            );
        }

        return "vlc";
    }

    if (
        vlcAvailable &&
        provider === "dailymotion"
    ) {
        return "vlc";
    }

    return "ffmpeg";
}

function reserveUdpPort(
    host = "127.0.0.1"
) {
    return new Promise(
        (resolve, reject) => {
            const socket =
                dgram.createSocket(
                    "udp4"
                );

            const fail = error => {
                try {
                    socket.close();
                } catch {
                    // Já fechado.
                }
                reject(error);
            };

            socket.once(
                "error",
                fail
            );

            socket.bind(
                0,
                host,
                () => {
                    const address =
                        socket.address();
                    const port =
                        typeof address === "object"
                            ? address.port
                            : 0;

                    socket.removeListener(
                        "error",
                        fail
                    );

                    socket.close(
                        () => {
                            if (!port) {
                                reject(
                                    new Error(
                                        "Não foi possível reservar uma porta UDP local para o VLC."
                                    )
                                );
                                return;
                            }

                            resolve(port);
                        }
                    );
                }
            );
        }
    );
}

function vlcSout(
    videoPort,
    audioPort = null
) {
    const videoDst =
        `dst=std{access=udp,mux=ts,dst=127.0.0.1:${videoPort}}`;

    if (!audioPort) {
        return (
            "#duplicate{" +
            videoDst +
            "}"
        );
    }

    const audioDst =
        `dst=std{access=udp,mux=ts,dst=127.0.0.1:${audioPort}}`;

    return (
        "#duplicate{" +
        videoDst +
        "," +
        audioDst +
        "}"
    );
}

function buildVlcArgs(
    sourceUrl,
    {
        videoPort,
        audioPort = null,
        userAgent = "",
        referer = "",
        networkCachingMs = 1200
    } = {}
) {
    if (
        typeof sourceUrl !== "string" ||
        !sourceUrl.trim()
    ) {
        throw new Error(
            "URL inválida para a ponte VLC."
        );
    }

    if (
        !Number.isSafeInteger(videoPort) ||
        videoPort <= 0 ||
        videoPort > 65535
    ) {
        throw new Error(
            "Porta de vídeo inválida para a ponte VLC."
        );
    }

    if (
        audioPort !== null &&
        (
            !Number.isSafeInteger(audioPort) ||
            audioPort <= 0 ||
            audioPort > 65535
        )
    ) {
        throw new Error(
            "Porta de áudio inválida para a ponte VLC."
        );
    }

    const args = [
        "--intf=dummy",
        "--dummy-quiet",
        "--no-video-title-show",
        "--no-sout-all",
        "--sout-keep",
        `--network-caching=${Math.max(
            100,
            Math.min(
                10000,
                Math.round(
                    Number(networkCachingMs) ||
                    1200
                )
            )
        )}`
    ];

    const safeUserAgent =
        cleanText(
            userAgent,
            512
        );

    if (safeUserAgent) {
        args.push(
            `--http-user-agent=${safeUserAgent}`
        );
    }

    const safeReferer =
        cleanText(
            referer,
            2048
        );

    if (safeReferer) {
        args.push(
            `--http-referrer=${safeReferer}`
        );
    }

    args.push(
        sourceUrl,
        `--sout=${vlcSout(
            videoPort,
            audioPort
        )}`
    );

    return args;
}

function udpInputUrl(port) {
    return (
        `udp://127.0.0.1:${port}` +
        "?overrun_nonfatal=1&fifo_size=5000000"
    );
}

async function startVlcInputBridge(
    sourceUrl,
    {
        vlcPath = null,
        userAgent = "",
        referer = "",
        withAudioCopy = true,
        networkCachingMs = 1200,
        spawnImpl = spawn
    } = {}
) {
    const executable =
        vlcPath ||
        findVlcPath();

    if (!executable) {
        throw new Error(
            "VLC não encontrado. Instale o VLC 64-bit ou defina SANTTOS_VLC_PATH."
        );
    }

    const videoPort =
        await reserveUdpPort();
    const audioPort =
        withAudioCopy
            ? await reserveUdpPort()
            : null;

    const args =
        buildVlcArgs(
            sourceUrl,
            {
                videoPort,
                audioPort,
                userAgent,
                referer,
                networkCachingMs
            }
        );

    const child =
        spawnImpl(
            executable,
            args,
            {
                windowsHide: true,
                stdio: [
                    "ignore",
                    "ignore",
                    "pipe"
                ]
            }
        );

    let stderr = "";
    let stopped = false;

    child.stderr?.on(
        "data",
        chunk => {
            stderr =
                (stderr + chunk.toString())
                    .slice(-5000);
        }
    );

    const stop = () => {
        if (stopped) return;
        stopped = true;

        try {
            if (!child.killed) {
                child.kill();
            }
        } catch {
            // Processo já encerrado.
        }
    };

    return {
        process: child,
        executable,
        videoPort,
        audioPort,
        videoUrl:
            udpInputUrl(
                videoPort
            ),
        audioUrl:
            audioPort
                ? udpInputUrl(
                      audioPort
                  )
                : null,
        stop,
        stderr: () =>
            stderr
    };
}

module.exports = {
    candidateVlcPaths,
    findVlcPath,
    selectInputEngine,
    reserveUdpPort,
    vlcSout,
    buildVlcArgs,
    udpInputUrl,
    startVlcInputBridge
};
