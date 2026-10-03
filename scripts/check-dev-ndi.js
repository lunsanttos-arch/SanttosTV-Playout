"use strict";

const { checkNdiRuntime } = require("../src/core/ndi/ndi-capabilities");

const result = checkNdiRuntime({ requireModern: true });
const lifecycle =
    String(process.env.npm_lifecycle_event || "");
const requireNdi =
    process.env.SANTTOS_REQUIRE_NDI === "1" ||
    lifecycle.includes("ndi-test");

if (result.ok && result.modern) {
    console.log("NDI preflight OK — sender atual pronto.");
    process.exit(0);
}

if (!requireNdi) {
    console.warn("");
    console.warn("NDI PRECHECK: sender nativo nao disponivel.");
    console.warn(result.error || "Sender NDI atual nao esta pronto.");
    console.warn("O Santtos vai abrir em DEV NULL SINK para permitir testes de PROGRAM, VLC e Inputs.");
    console.warn("A saida NDI real ficara desativada neste PC ate o sender ser compilado.");
    console.warn("");
    process.exit(0);
}

console.error("");
console.error("NDI PRECHECK FALHOU.");
console.error(result.error || "Sender NDI atual nao esta pronto.");
console.error("");
console.error("Abra o 'x64 Native Tools Command Prompt for VS 2022' e rode:");
console.error("  cd /d C:\\SanttosTV-Playout");
console.error("  scripts\\build-ndi.cmd");
console.error("");
console.error("Depois execute novamente o Santtos Playout.");
process.exit(1);
