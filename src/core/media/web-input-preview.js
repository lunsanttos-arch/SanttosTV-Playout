"use strict";

const { Readable } = require("node:stream");
const { spawn } = require("node:child_process");
const {
    isHttpInput,
    remoteInputArgs
} = require("../playout/remote-input");
const {
    resolveRemoteInput
} = require("../playout/remote-input-resolver");
const {
    createRemoteHlsProxy
} = require("../playout/remote-input-proxy");
const {
    findVlcPath,
    selectInputEngine,
    startVlcInputBridge
} = require("../playout/vlc-input-bridge");

const INPUT_PREVIEW_SCHEME = "santtos-input";

function inputPreviewUrl(inputId) {
    if (typeof inputId !== "string" || !inputId.trim()) {
        return "";
    }

    return `${INPUT_PREVIEW_SCHEME}://preview/${encodeURIComponent(inputId.trim())}`;
}

function previewInputId(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        if (
            parsed.protocol !== `${INPUT_PREVIEW_SCHEME}:` ||
            parsed.hostname !== "preview"
        ) {
            return null;
        }

        const encoded =
            parsed.pathname
                .replace(/^\/+/, "")
                .split("/")[0];

        return encoded
            ? decodeURIComponent(encoded)
            : null;
    } catch {
        return null;
    }
}

async function serveWebInputPreview(
    request,
    inputs,
    {
        ffmpegPath
    } = {}
) {
    const inputId =
        previewInputId(
            request.url
        );

    const input =
        Array.isArray(inputs)
            ? inputs.find(
                  (item) =>
                      item.id === inputId
              )
            : null;

    if (!input) {
        return new Response(
            "Input não encontrado.",
            { status: 404 }
        );
    }

    // A prévia HTTP/HLS abre uma segunda conexão de baixa resolução.
    // SRT pode ser ponto-a-ponto e não deve ser consumido duas vezes:
    // ele continua sendo exibido pelo PROGRAM/NDI.
    if (!isHttpInput(input.url)) {
        return new Response(
            "Prévia local disponível para HTTP/HLS. SRT permanece no PROGRAM/NDI.",
            { status: 415 }
        );
    }

    if (
        typeof ffmpegPath !== "string" ||
        !ffmpegPath
    ) {
        return new Response(
            "FFmpeg indisponível para a prévia.",
            { status: 503 }
        );
    }

    let resolved;

    try {
        resolved =
            await resolveRemoteInput(
                input.url,
                {
                    userAgent:
                        input.httpUserAgent ?? "",
                    referer:
                        input.httpReferer ?? ""
                }
            );
    } catch (error) {
        return new Response(
            String(
                error?.message ||
                "Não foi possível resolver a origem do Input."
            ),
            { status: 502 }
        );
    }

    let playbackUrl =
        resolved.url;
    let proxy = null;
    let vlcBridge = null;

    const vlcPath =
        findVlcPath();

    let engine;

    try {
        engine =
            selectInputEngine(
                input.engine,
                resolved.provider,
                Boolean(vlcPath)
            );
    } catch (error) {
        return new Response(
            String(
                error?.message ||
                "Motor VLC indisponível."
            ),
            { status: 503 }
        );
    }

    if (
        resolved.provider ===
        "dailymotion"
    ) {
        try {
            proxy =
                await createRemoteHlsProxy(
                    resolved
                );
            playbackUrl =
                proxy.url;
        } catch (error) {
            return new Response(
                String(
                    error?.message ||
                    "Não foi possível iniciar o proxy interno do Input."
                ),
                { status: 502 }
            );
        }
    }

    if (engine === "vlc") {
        try {
            vlcBridge =
                await startVlcInputBridge(
                    playbackUrl,
                    {
                        vlcPath,
                        userAgent:
                            resolved.provider === "dailymotion"
                                ? ""
                                : resolved.userAgent,
                        referer:
                            resolved.provider === "dailymotion"
                                ? ""
                                : resolved.referer,
                        withAudioCopy:
                            false
                    }
                );

            playbackUrl =
                vlcBridge.videoUrl;
        } catch (error) {
            if (
                (input.engine ?? "auto") !==
                "auto"
            ) {
                if (proxy) {
                    proxy.close();
                    proxy = null;
                }

                return new Response(
                    String(
                        error?.message ||
                        "Não foi possível iniciar a ponte VLC."
                    ),
                    { status: 502 }
                );
            }

            engine = "ffmpeg";
            console.warn(
                "Prévia VLC falhou no modo Automático; usando FFmpeg:",
                error
            );
        }
    }

    const args = [
        "-hide_banner",
        "-loglevel",
        "warning",
        "-nostdin",
        "-fflags",
        "+genpts+discardcorrupt",
        ...(
            isHttpInput(playbackUrl)
                ? remoteInputArgs(
                      playbackUrl,
                      {
                          protocolHint:
                              input.protocol,
                          userAgent:
                              resolved.userAgent,
                          referer:
                              resolved.referer,
                          cookie:
                              resolved.provider === "dailymotion"
                                  ? ""
                                  : resolved.cookie,
                          realtime: true
                      }
                  )
                : []
        ),
        "-i",
        playbackUrl,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-vf",
        "scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2:black,fps=30",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-tune",
        "zerolatency",
        "-pix_fmt",
        "yuv420p",
        "-g",
        "30",
        "-keyint_min",
        "30",
        "-sc_threshold",
        "0",
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-movflags",
        "frag_keyframe+empty_moov+default_base_moof",
        "-flush_packets",
        "1",
        "-f",
        "mp4",
        "pipe:1"
    ];

    const child =
        spawn(
            ffmpegPath,
            args,
            {
                windowsHide: true,
                stdio: [
                    "ignore",
                    "pipe",
                    "pipe"
                ]
            }
        );

    let stderr = "";

    child.stderr.on(
        "data",
        (chunk) => {
            stderr =
                (stderr + chunk.toString())
                    .slice(-1200);
        }
    );

    child.on(
        "error",
        (error) => {
            if (vlcBridge) {
                vlcBridge.stop();
                vlcBridge = null;
            }

            if (proxy) {
                proxy.close();
                proxy = null;
            }

            console.error(
                "Falha na prévia do Input:",
                error
            );
        }
    );

    child.on(
        "exit",
        (code, signal) => {
            if (vlcBridge) {
                vlcBridge.stop();
                vlcBridge = null;
            }

            if (proxy) {
                proxy.close();
                proxy = null;
            }

            if (
                code !== 0 &&
                !signal
            ) {
                console.warn(
                    "Prévia do Input encerrada:",
                    code,
                    stderr
                );
            }
        }
    );

    request.signal?.addEventListener(
        "abort",
        () => {
            if (vlcBridge) {
                vlcBridge.stop();
                vlcBridge = null;
            }

            if (proxy) {
                proxy.close();
                proxy = null;
            }

            try {
                if (!child.killed) {
                    child.kill();
                }
            } catch {
                // Preview já encerrado.
            }
        },
        { once: true }
    );

    return new Response(
        Readable.toWeb(
            child.stdout
        ),
        {
            status: 200,
            headers: {
                "Content-Type":
                    "video/mp4",
                "Cache-Control":
                    "no-store, no-cache, must-revalidate",
                "Accept-Ranges":
                    "none"
            }
        }
    );
}

module.exports = {
    INPUT_PREVIEW_SCHEME,
    inputPreviewUrl,
    previewInputId,
    serveWebInputPreview
};
