"use strict";
const { checkNdiRuntime } = require("../src/core/ndi/ndi-capabilities");

const result = checkNdiRuntime();
if (result.ok) {
    console.log("NDI x64 PRONTO — AUDIO_PIPE_V1, fonte QA separada e áudio PCM estéreo.");
} else {
    console.error("NDI indisponível:", result.error);
    process.exitCode = 1;
}
