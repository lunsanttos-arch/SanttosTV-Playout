"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const nativeFolder = __dirname;
const executable = path.join(nativeFolder, "ndi_test.exe");
const dll = path.join(nativeFolder, "Processing.NDI.Lib.x64.dll");
const CAPS = "SANTTOS_NDI_CAPS: AUDIO_PIPE_V1 NAME_ARGUMENT_V1";

function checkNdiRuntime({ requireModern = true, executablePath = executable,
    dllPath = dll } = {}) {
    if (process.platform !== "win32") {
        return { ok: false, error: "O emissor NDI nativo deste projeto é Windows x64." };
    }
    if (!fs.existsSync(executablePath) || !fs.existsSync(dllPath)) {
        return { ok: false, error:
            "ndi_test.exe e/ou Processing.NDI.Lib.x64.dll ausentes. Recompile o sender com o SDK NDI antes do teste." };
    }
    // Do NOT execute an old sender with --capabilities. The old build
    // ignores args and would publish the production PROGRAM briefly.
    const bytes = fs.readFileSync(executablePath);
    if (!bytes.includes(Buffer.from("SANTTOS_NDI_CAPS"))) {
        return { ok: !requireModern, modern: false, error: requireModern
            ? "Sender NDI antigo: compile o novo ndi_test.cpp antes de ativar o áudio ou o modo QA."
            : null };
    }
    const probe = spawnSync(executablePath, ["--capabilities"], {
        cwd: path.dirname(executablePath),
        windowsHide: true,
        timeout: 3000,
        encoding: "utf8",
        input: ""
    });
    const modern = probe.status === 0 && probe.stdout?.includes(CAPS);
    return {
        ok: modern || !requireModern,
        modern,
        error: modern ? null : "O sender NDI não confirmou AUDIO_PIPE_V1 e NAME_ARGUMENT_V1."
    };
}

if (require.main === module) {
    const result = checkNdiRuntime();
    if (result.ok) {
        console.log("NDI x64 PRONTO — AUDIO_PIPE_V1, fonte QA separada e áudio PCM estéreo.");
    } else {
        console.error("NDI indisponível:", result.error);
        process.exitCode = 1;
    }
}

module.exports = { checkNdiRuntime, CAPS };
