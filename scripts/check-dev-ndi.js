"use strict";

const { checkNdiRuntime } = require("../src/core/ndi/ndi-capabilities");

const result = checkNdiRuntime({ requireModern: true });

if (result.ok && result.modern) {
    console.log("NDI preflight OK — sender atual pronto.");
    process.exit(0);
}

console.error("");
console.error("NDI PRECHECK FALHOU.");
console.error(result.error || "Sender NDI atual não está pronto.");
console.error("");
console.error("Abra o 'x64 Native Tools Command Prompt for VS 2022' e rode:");
console.error("  cd /d C:\\SanttosTV-Playout");
console.error("  scripts\\build-ndi.cmd");
console.error("");
console.error("Depois execute novamente o Santtos Playout.");
process.exit(1);
