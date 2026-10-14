const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { supportedMediaVersion, verifyProgramRuntime, resolveMediaRuntime } = require("../src/core/media/runtime-paths");
for (const version of ["6.1.5", "7.0.2", "7.1", "7.1.4", "N-1234", "unknown"]) assert(!supportedMediaVersion("ffmpeg version " + version));
for (const version of ["7.1.5", "7.1.10", "n7.2", "8.0.1"]) assert(supportedMediaVersion("ffmpeg version " + version + "-vendor"));
execFileSync(process.execPath, ["--check", "scripts/check-native-runtime.js"]);
if (process.env.FFMPEG_BIN) verifyProgramRuntime(resolveMediaRuntime("ffmpeg"));
console.log("MEDIA RUNTIME: release floor and native gate syntax verified");
