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
console.log("NDI runtime: executavel e biblioteca localizados.");
