"use strict";
const { checkNdiRuntime } = require("../src/core/ndi/ndi-capabilities");

// Shared preflight for both the CMD command and dev:ndi-test.
// Importing this module must not run or terminate the caller.
if (require.main === module) {
    const result = checkNdiRuntime();
    if (result.ok) {
        console.log("NDI x64 PRONTO — AUDIO_PIPE_V1, fonte QA separada e áudio PCM estéreo.");
    } else {
        console.error("NDI indisponível:", result.error);
        process.exitCode = 1;
    }
}

module.exports = { checkNdiRuntime };
