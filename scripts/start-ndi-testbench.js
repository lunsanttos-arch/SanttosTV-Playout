"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");
const { checkNdiRuntime } = require("./check-ndi-audio");

const checked = checkNdiRuntime();
if (!checked.ok) {
    console.error("TESTE NDI BLOQUEADO:", checked.error);
    console.error("Compile o sender NDI com o SDK x64 (ver docs/TESTE-NDI-AUDIO.md).");
    process.exitCode = 1;
} else {
    console.log("NDI QA: banco isolado e fonte exclusiva Santtos TV - QA.");
    console.log("ATENÇÃO: ESTA VERSÃO TRANSMITE VÍDEO E ÁUDIO PELA REDE NDI.");
    const child = spawn(
        process.platform === "win32" ? "npm.cmd" : "npm",
        ["run", "dev"],
        {
            cwd: path.resolve(__dirname, ".."),
            env: {
                ...process.env,
                SANTTOS_TEST_MODE: "0",
                SANTTOS_NDI_TEST_MODE: "1"
            },
            stdio: "inherit",
            shell: process.platform === "win32"
        }
    );
    child.on("error", error => {
        console.error("Não foi possível iniciar bancada NDI:", error);
        process.exitCode = 1;
    });
    child.on("exit", code => {
        process.exitCode = code === null ? 1 : code;
    });
}
