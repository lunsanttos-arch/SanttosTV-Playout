"use strict";

const { spawn } = require("node:child_process");

console.log("BANCADA ISOLADA: banco exclusivo e saida NDI desativada.");
console.log("Este modo serve para testar interface, biblioteca, grade e relatorios.");
const child = spawn(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "dev"],
    {
        cwd: require("node:path").resolve(__dirname, ".."),
        env: { ...process.env, SANTTOS_TEST_MODE: "1" },
        stdio: "inherit",
        shell: process.platform === "win32"
    }
);
child.on("error", (error) => {
    console.error("Nao foi possivel abrir a bancada:", error);
    process.exitCode = 1;
});
child.on("exit", (code, signal) => {
    if (signal) console.warn("Bancada encerrada por sinal:", signal);
    process.exitCode = code === null ? 1 : code;
});
