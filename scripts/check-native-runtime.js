"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ndiFolder = path.resolve(__dirname, "../src/core/ndi");
const required = ["ndi_test.exe", "Processing.NDI.Lib.x64.dll"];
const missing = required.filter((name) => !fs.existsSync(path.join(ndiFolder, name)));
if (missing.length > 0) {
    console.error("PACOTE BLOQUEADO: engine nativo NDI incompleto: " + missing.join(", "));
    console.error("Compile src/core/ndi/ndi_test.cpp com o SDK NDI x64 e copie");
    console.error("o executavel e o runtime DLL licenciado para src/core/ndi.");
    console.error("Nao distribuir uma versao que exibe NDI ONLINE sem sender funcional.");
    process.exit(1);
}
const { checkNdiRuntime } = require("../src/core/ndi/ndi-capabilities");
const native = checkNdiRuntime();
if (!native.ok || !native.modern) {
    console.error("PACOTE BLOQUEADO: novo sender com áudio PCM obrigatório.");
    console.error(native.error || "Recompile src/core/ndi/ndi_test.cpp com o SDK NDI x64.");
    process.exit(1);
}
console.log("NDI runtime: sender x64 atualizado, perfil PROGRAM dinâmico e áudio PCM configurável.");


const omtFolder = path.resolve(__dirname, "../src/core/omt");
const omtRequired = ["omt_sender.exe", "libomt.dll", "libvmx.dll"];
const omtMissing = omtRequired.filter((name) => !fs.existsSync(path.join(omtFolder, name)));
if (omtMissing.length > 0) {
    console.error("PACOTE BLOQUEADO: runtime OMT incompleto: " + omtMissing.join(", "));
    process.exit(1);
}
console.log("OMT runtime: sender x64 e codecs oficiais presentes.");

const runtime = path.resolve(__dirname, "../src/core/runtime");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const { supportedMediaVersion, verifyProgramRuntime } = require("../src/core/media/runtime-paths");
const manifestFile = path.join(runtime, "manifest.json");
if (!fs.existsSync(manifestFile)) {
    console.error("PACOTE BLOQUEADO: forneça FFmpeg/FFprobe de release e manifest com hashes em src/core/runtime.");
    process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
for (const name of ["ffmpeg", "ffprobe"]) {
    const file = path.join(runtime, name + ".exe");
    if (!fs.existsSync(file)) { console.error("PACOTE BLOQUEADO: runtime ausente: " + name); process.exit(1); }
    const actual = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    if (actual !== manifest[name + "Sha256"]) { console.error("PACOTE BLOQUEADO: hash inválido: " + name); process.exit(1); }
    const version = execFileSync(file, ["-version"], { encoding: "utf8", windowsHide: true });
    if (!supportedMediaVersion(version)) {
        console.error("PACOTE BLOQUEADO: versão FFmpeg/FFprobe anterior à base mínima homologável 7.1.5.");
        process.exit(1);
    }
}
verifyProgramRuntime(path.join(runtime, "ffmpeg.exe"));
console.log("Runtime de mídia: versão, integridade, filtros, codecs e protocolos verificados.");
