"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Both bench modes have separate databases. Only the opt-in NDI QA mode
 * may start a native sender, always named "Santtos TV - QA".
 */
function configureTestBench(app, environment = process.env) {
    const ndiEnabled = !app.isPackaged && environment.SANTTOS_NDI_TEST_MODE === "1";
    const enabled = !app.isPackaged &&
        (environment.SANTTOS_TEST_MODE === "1" || ndiEnabled);
    if (!enabled) {
        return {
            enabled: false,
            ndiEnabled: false,
            sourceName: "Santtos TV - PROGRAM",
            userDataPath: app.getPath("userData")
        };
    }
    const root = path.join(
        app.getPath("appData"),
        ndiEnabled ? "SanttosTVAutomation-NDI-QA"
                   : "SanttosTVAutomation-Testbench"
    );
    fs.mkdirSync(root, { recursive: true });
    app.setPath("userData", root);
    return {
        enabled: true,
        ndiEnabled,
        sourceName: ndiEnabled ? "Santtos TV - QA" : null,
        userDataPath: root
    };
}

module.exports = { configureTestBench };
