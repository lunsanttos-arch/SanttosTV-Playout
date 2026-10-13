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
        "writeVideo("
    ) &&
    controller.includes(
        "frame,"
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
    controller.includes(
        "allowDrop = true"
    ) &&
    controller.includes(
        "onceVideoDrain(callback)"
    ),
    "Controller OMT deve suportar modo auxiliar com drop e modo OMT-only com backpressure."
);
assert(
    electronMain.includes(
        "const ndiFrameReady ="
    ) &&
    electronMain.includes(
        "allowDrop:"
    ) &&
    electronMain.includes(
        "ndiFrameReady ||"
    ) &&
    electronMain.includes(
        "isRemoteInput"
    ) &&
    electronMain.includes(
        "!ndiFrameReady &&"
    ) &&
    electronMain.includes(
        "omtTarget.onceVideoDrain"
    ),
    "OMT deve ser não bloqueante ao lado do NDI, mas assumir o pacing quando for a única saída."
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
    assert(
        output.includes(
            "RUNTIME_PROBE_V1"
        )
    );

    const runtimeProbe =
        execFileSync(
            path.join(
                omtFolder,
                "omt_sender.exe"
            ),
            ["--runtime-probe"],
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
        runtimeProbe.includes(
            "OMT RUNTIME READY"
        ),
        "Sender OMT deve carregar libomt/libvmx e criar um sender real."
    );
}

async function testSpawnFailure() {
    const { OmtOutput } = require("../src/core/omt/omt-output");
    let timeout;
    let output;
    try {
        await new Promise((resolve, reject) => {
            timeout = setTimeout(() => reject(new Error("OMT spawn failure did not request a restart")), 3000);
            output = new OmtOutput({ runtimeFolder: omtFolder, profile,
                onUnexpectedExit: (reason) => {
                    try {
                        assert.equal(output.process, null);
                        assert.equal(output.online, false);
                        assert.match(reason, /ENOENT/);
                        resolve();
                    } catch (error) { reject(error); }
                }
            });
            // Simulate the executable disappearing after the runtime preflight.
            output.validateRuntime = () => ({ executable: path.join(omtFolder, "missing-qa-sender.exe") });
            output.start();
        });
    } finally { clearTimeout(timeout); output?.stop(); }
    console.log("OMT QA: APROVADO — contrato e recuperação de falha; runtime nativo verificado somente no Windows.");
}
testSpawnFailure().catch(error => { console.error(error); process.exitCode = 1; });
