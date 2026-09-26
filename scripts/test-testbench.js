"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { configureTestBench } = require("../src/main/testbench");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "santtos-bancada-"));
try {
    const productionData = path.join(root, "SanttosTVAutomation");
    fs.mkdirSync(productionData);
    const originalFile = path.join(productionData, "santtos-tv.json");
    fs.writeFileSync(originalFile, "DADOS DE PRODUCAO");

    function fakeApp(isPackaged) {
        const paths = { appData: root, userData: productionData };
        return {
            isPackaged,
            getPath(name) { return paths[name]; },
            setPath(name, value) { paths[name] = value; }
        };
    }

    const dev = fakeApp(false);
    const test = configureTestBench(dev, { SANTTOS_TEST_MODE: "1" });
    assert.equal(test.enabled, true);
    assert.notEqual(dev.getPath("userData"), productionData);
    assert.equal(test.userDataPath, path.join(root, "SanttosTVAutomation-Testbench"));
    assert.equal(fs.readFileSync(originalFile, "utf8"), "DADOS DE PRODUCAO");

    const ndiQaApp = fakeApp(false);
    const ndiQa = configureTestBench(ndiQaApp, { SANTTOS_NDI_TEST_MODE: "1" });
    assert.equal(ndiQa.enabled, true);
    assert.equal(ndiQa.ndiEnabled, true);
    assert.equal(ndiQa.sourceName, "Santtos TV - QA");
    assert.notEqual(ndiQa.userDataPath, test.userDataPath);
    assert.notEqual(ndiQa.userDataPath, productionData);
    assert.equal(fs.readFileSync(originalFile, "utf8"), "DADOS DE PRODUCAO");
    assert.equal(test.ndiEnabled, false);
    assert.equal(test.sourceName, null);

    const ordinary = configureTestBench(fakeApp(false), {});
    assert.equal(ordinary.enabled, false);
    assert.equal(ordinary.userDataPath, productionData);

    const packaged = configureTestBench(fakeApp(true), { SANTTOS_TEST_MODE: "1" });
    assert.equal(packaged.enabled, false);
    assert.equal(packaged.userDataPath, productionData);

    const main = fs.readFileSync(path.join(__dirname, "../src/main/main.js"), "utf8");
    const renderer = fs.readFileSync(path.join(__dirname, "../src/renderer/src/App.tsx"), "utf8");
    assert(main.includes("if (nativeOutputAllowed) {") &&
        main.includes("const nativeOutputAllowed = !isTestBench || isNdiTestBench;") &&
        main.includes("ndiSourceName = isNdiTestBench ?"),
        "Somente bancada com opt-in NDI pode abrir a fonte exclusiva QA.");
    assert(renderer.includes("if (!nativeOutputEnabled) return;"),
        "Bancada comum deve permitir prévia sem abrir NDI.");
    assert(renderer.includes("PRÉVIA DE TESTE"), "A interface deve identificar a bancada.");

    console.log("TESTBENCH QA: APROVADO — dados separados e NDI bloqueado por padrao.");
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
