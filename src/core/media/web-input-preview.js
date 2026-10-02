"use strict";

const { Readable } = require("node:stream");
const { spawn } = require("node:child_process");
const {
    isHttpInput,
    remoteInputArgs
} = require("../playout/remote-input");

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

function serveWebInputPreview(
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

    const args = [
        "-hide_banner",
        "-loglevel",
        "warning",
        "-nostdin",
        "-fflags",
        "+genpts+discardcorrupt",
        ...remoteInputArgs(
            input.url,
            {
                protocolHint:
                    input.protocol,
                userAgent:
                    input.httpUserAgent ?? "",
                referer:
                    input.httpReferer ?? "",
                realtime: true
            }
        ),
        "-i",
        input.url,
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
            console.error(
                "Falha na prévia do Input:",
                error
            );
        }
    );

    child.on(
        "exit",
        (code, signal) => {
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
