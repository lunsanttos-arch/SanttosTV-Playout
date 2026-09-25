"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * A bancada nunca compartilha o banco de producao, mesmo quando ambos os
 * processos rodam sob a mesma conta do Windows.
 */
function configureTestBench(app, environment = process.env) {
    const enabled = !app.isPackaged && environment.SANTTOS_TEST_MODE === "1";
    if (!enabled) return { enabled: false, userDataPath: app.getPath("userData") };
    const root = path.join(app.getPath("appData"), "SanttosTVAutomation-Testbench");
    fs.mkdirSync(root, { recursive: true });
    app.setPath("userData", root);
    return { enabled: true, userDataPath: root };
}

module.exports = { configureTestBench };
