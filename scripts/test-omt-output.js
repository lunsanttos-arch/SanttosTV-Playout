"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
    outputProfile,
    profileSignature
} = require("../src/core/playout/output-profile");

const omtFolder =
    path.resolve(
        __dirname,
        "../src/core/omt"
    );

const required = [
    "omt_sender.exe",
    "libomt.dll",
    "libvmx.dll"
];

for (const name of required) {
    assert(
        fs.existsSync(
            path.join(
                omtFolder,
                name
            )
        ),
        "Runtime OMT ausente: " + name
    );
}

const profile =
    outputProfile({
        resolution: "1920x1080",
        fps: "29.97",
        scanMode: "progressive",
        aspectRatio: "16:9",
        pixelFormat: "yuv420p",
        audio: {
            sampleRate: 48000,
            channels: 2
        },
        ndi: {
            enabled: false,
            name: "NDI desligado"
        },
        omt: {
            enabled: true,
            name: "SanTTos QA OMT",
            quality: "low"
        }
    });

assert.equal(
    profile.omtEnabled,
    true
);
assert.equal(
    profile.omtName,
    "SanTTos QA OMT"
);
assert.equal(
    profile.omtQuality,
    "low"
);
assert(
    profileSignature(profile)
        .includes("omt-on")
);

const controller =
    fs.readFileSync(
        path.join(
            omtFolder,
            "omt-output.js"
        ),
        "utf8"
    );

const electronMain =
    fs.readFileSync(
        path.resolve(
            __dirname,
            "../src/main/main.js"
        ),
        "utf8"
    );

assert(
    controller.includes(
        "SanttosOmtAudio-"
    )
);
assert(
    controller.includes(
        "writeVideo(frame)"
    )
);
assert(
    controller.includes(
        "writeAudio(chunk)"
    )
);
assert(
    controller.includes(
        "videoFramesDropped"
    ) &&
    controller.includes(
        "target.writableLength"
    ),
    "Saída OMT deve ter buffer limitado e descartar apenas quadros OMT sob backpressure."
);
assert(
    !electronMain.includes(
        "omtOutput.onceVideoDrain"
    ),
    "Backpressure OMT não pode pausar o decoder principal ou o NDI."
);

if (process.platform === "win32") {
    const output =
        execFileSync(
            path.join(
                omtFolder,
                "omt_sender.exe"
            ),
            ["--capabilities"],
            {
                cwd:
                    omtFolder,
                encoding:
                    "utf8",
                windowsHide:
                    true
            }
        );

    assert(
        output.includes(
            "SANTTOS_OMT_CAPS:"
        )
    );
    assert(
        output.includes(
            "VIDEO_STDIN_V1"
        )
    );
    assert(
        output.includes(
            "AUDIO_PIPE_V1"
        )
    );
}

console.log(
    "OMT QA: APROVADO — runtime oficial, sender nativo, vídeo do PROGRAM e áudio PCM compartilhado."
);
