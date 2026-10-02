"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const ffmpegStatic = require("ffmpeg-static");
const {
    isRemoteInputUrl,
    isHlsInput,
    remoteInputArgs
} = require("../src/core/playout/remote-input");
const {
    serveWebInputPreview
} = require("../src/core/media/web-input-preview");

function ffmpegPath() {
    if (typeof ffmpegStatic !== "string" || !ffmpegStatic) {
        throw new Error("ffmpeg-static indisponível.");
    }
    return ffmpegStatic.replace("app.asar", "app.asar.unpacked");
}

function runFfmpeg(args, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        const child = spawn(
            ffmpegPath(),
            args,
            {
                windowsHide: true,
                stdio: ["ignore", "ignore", "pipe"]
            }
        );

        let stderr = "";
        let settled = false;

        const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill();
            reject(
                new Error(
                    "FFmpeg excedeu o timeout. " +
                    stderr.slice(-1200)
                )
            );
        }, timeoutMs);

        child.stderr.on("data", (chunk) => {
            stderr =
                (stderr + chunk.toString())
                    .slice(-8000);
        });

        child.on("error", (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            reject(error);
        });

        child.on("exit", (code, signal) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);

            if (code === 0 && !signal) {
                resolve();
                return;
            }

            reject(
                new Error(
                    `FFmpeg saiu com código ${code}, sinal ${signal || "-"}. ${stderr.slice(-1200)}`
                )
            );
        });
    });
}

function contentType(filePath) {
    const extension =
        path.extname(filePath)
            .toLowerCase();

    if (extension === ".m3u8") {
        return "application/vnd.apple.mpegurl";
    }

    if (extension === ".ts") {
        return "video/mp2t";
    }

    return "application/octet-stream";
}

async function main() {
    assert.equal(
        isRemoteInputUrl(
            "https://example.com/live.m3u8"
        ),
        true
    );
    assert.equal(
        isHlsInput(
            "https://example.com/live?id=1",
            "hls"
        ),
        true
    );

    const policy = remoteInputArgs(
        "https://example.com/live/test.m3u8",
        {
            protocolHint: "hls",
            realtime: true
        }
    );

    assert(policy.includes("-re"));
    assert(policy.includes("-reconnect"));
    assert(policy.includes("-rw_timeout"));
    assert(policy.includes("-user_agent"));

    const temp =
        fs.mkdtempSync(
            path.join(
                os.tmpdir(),
                "santtos-web-input-"
            )
        );

    try {
        const playlist =
            path.join(
                temp,
                "index.m3u8"
            );
        const segmentPattern =
            path.join(
                temp,
                "segment-%03d.ts"
            );

        await runFfmpeg([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=320x180:rate=25",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1000:sample_rate=48000",
            "-t",
            "4",
            "-c:v",
            "mpeg2video",
            "-q:v",
            "5",
            "-c:a",
            "mp2",
            "-b:a",
            "128k",
            "-f",
            "hls",
            "-hls_time",
            "1",
            "-hls_list_size",
            "0",
            "-hls_segment_filename",
            segmentPattern,
            "-y",
            playlist
        ]);

        assert(
            fs.existsSync(
                playlist
            ),
            "Playlist HLS de QA não foi criada."
        );

        const server =
            http.createServer(
                (request, response) => {
                    const pathname =
                        decodeURIComponent(
                            new URL(
                                request.url,
                                "http://127.0.0.1"
                            ).pathname
                        );
                    const relative =
                        pathname
                            .replace(/^\/+/, "");

                    if (
                        !/^[a-zA-Z0-9._-]+$/.test(
                            relative
                        )
                    ) {
                        response.writeHead(400);
                        response.end();
                        return;
                    }

                    const filePath =
                        path.join(
                            temp,
                            relative
                        );

                    if (
                        !fs.existsSync(
                            filePath
                        )
                    ) {
                        response.writeHead(404);
                        response.end();
                        return;
                    }

                    response.writeHead(
                        200,
                        {
                            "Content-Type":
                                contentType(
                                    filePath
                                ),
                            "Cache-Control":
                                "no-store"
                        }
                    );

                    fs.createReadStream(
                        filePath
                    ).pipe(
                        response
                    );
                }
            );

        await new Promise((resolve) =>
            server.listen(
                0,
                "127.0.0.1",
                resolve
            )
        );

        try {
            const address =
                server.address();
            const port =
                typeof address === "object" &&
                address
                    ? address.port
                    : 0;
            const url =
                `http://127.0.0.1:${port}/index.m3u8`;

            await runFfmpeg([
                "-hide_banner",
                "-loglevel",
                "error",
                "-nostdin",
                "-fflags",
                "+genpts+discardcorrupt",
                ...remoteInputArgs(
                    url,
                    {
                        protocolHint: "hls",
                        realtime: true
                    }
                ),
                "-i",
                url,
                "-t",
                "1",
                "-map",
                "0:v:0",
                "-an",
                "-f",
                "null",
                "-"
            ]);

            const controller =
                new AbortController();
            const previewResponse =
                serveWebInputPreview(
                    new Request(
                        "santtos-input://preview/qa-hls",
                        {
                            signal:
                                controller.signal
                        }
                    ),
                    [
                        {
                            id: "qa-hls",
                            name: "HLS QA",
                            url,
                            protocol: "hls"
                        }
                    ],
                    {
                        ffmpegPath:
                            ffmpegPath()
                    }
                );

            assert.equal(
                previewResponse.status,
                200
            );
            assert.match(
                previewResponse.headers.get(
                    "content-type"
                ) || "",
                /video\/mp4/i
            );

            const reader =
                previewResponse.body.getReader();
            const chunks = [];
            let total = 0;

            try {
                while (total < 16384) {
                    const {
                        value,
                        done
                    } =
                        await reader.read();

                    if (done) break;
                    if (!value) continue;

                    chunks.push(
                        Buffer.from(
                            value
                        )
                    );
                    total +=
                        value.byteLength;
                }
            } finally {
                controller.abort();
                try {
                    await reader.cancel();
                } catch {
                    // O FFmpeg pode encerrar junto com o abort.
                }
            }

            const previewBytes =
                Buffer.concat(
                    chunks
                );

            assert(
                previewBytes.length > 1024,
                "Prévia do Input não entregou bytes suficientes."
            );
            assert(
                previewBytes.includes(
                    Buffer.from("ftyp")
                ),
                "Prévia do Input não começou como MP4 fragmentado."
            );
        } finally {
            await new Promise((resolve) =>
                server.close(resolve)
            );
        }
    } finally {
        fs.rmSync(
            temp,
            {
                recursive: true,
                force: true
            }
        );
    }

    console.log(
        "WEB INPUT QA: APROVADO — HLS aberto, decodificado e convertido em prévia MP4 pelo FFmpeg do Santtos."
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
