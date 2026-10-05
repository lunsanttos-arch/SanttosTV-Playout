"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const ffmpeg = require("ffmpeg-static");
const {
    JpegFrameParser
} = require("../src/core/playout/program-preview-tap");

function parseChunks(buffer) {
    const frames = [];
    const parser =
        new JpegFrameParser(
            frame =>
                frames.push(frame)
        );

    const cuts = [
        1,
        7,
        29,
        113,
        401,
        997
    ];

    let offset = 0;
    let index = 0;

    while (offset < buffer.length) {
        const size =
            cuts[
                index %
                cuts.length
            ];
        parser.write(
            buffer.subarray(
                offset,
                Math.min(
                    buffer.length,
                    offset + size
                )
            )
        );
        offset += size;
        index += 1;
    }

    return frames;
}

const root =
    fs.mkdtempSync(
        path.join(
            os.tmpdir(),
            "santtos-program-preview-"
        )
    );

try {
    const raw =
        path.join(
            root,
            "program.raw"
        );
    const mjpeg =
        path.join(
            root,
            "preview.mjpg"
        );

    execFileSync(
        ffmpeg,
        [
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=320x180:rate=30",
            "-t",
            "0.4",
            "-filter_complex",
            "[0:v]split=2[programSource][previewSource];" +
                "[programSource]format=yuv420p[program];" +
                "[previewSource]scale=160:-2:flags=fast_bilinear,fps=15,format=yuvj420p[preview]",
            "-map",
            "[program]",
            "-an",
            "-pix_fmt",
            "yuv420p",
            "-f",
            "rawvideo",
            "-y",
            raw,
            "-t",
            "0.4",
            "-map",
            "[preview]",
            "-an",
            "-c:v",
            "mjpeg",
            "-q:v",
            "5",
            "-f",
            "image2pipe",
            "-y",
            mjpeg
        ],
        {
            windowsHide: true,
            timeout: 30000
        }
    );

    assert(
        fs.statSync(raw).size >
            320 * 180,
        "Saída principal rawvideo deve continuar existindo."
    );

    const encoded =
        fs.readFileSync(
            mjpeg
        );
    const frames =
        parseChunks(
            encoded
        );

    assert(
        frames.length >= 4,
        "Tap de preview deve produzir vários JPEGs de baixa latência."
    );

    for (
        const frame of frames
    ) {
        assert.equal(
            frame[0],
            0xff
        );
        assert.equal(
            frame[1],
            0xd8
        );
        assert.equal(
            frame[
                frame.length - 2
            ],
            0xff
        );
        assert.equal(
            frame[
                frame.length - 1
            ],
            0xd9
        );
    }

    console.log(
        "PROGRAM PREVIEW TAP QA: APROVADO — mesma decodificação gera raw PROGRAM + MJPEG de monitor."
    );
} finally {
    fs.rmSync(
        root,
        {
            recursive: true,
            force: true
        }
    );
}
