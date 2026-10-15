"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const { writeReportSnapshot } = require("./playout-report");
async function exportSnapshot() {
    const data = workerData;
    if (data.stateFile) {
        const state = JSON.parse(require("node:fs").readFileSync(data.stateFile, "utf8"));
        data.rows = state.entries.filter(entry => entry.reportDate === data.dateKey &&
            ["EXECUTADO", "PULADO", "PULADO_POR_ERRO"].includes(entry.status))
            .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    }
    return writeReportSnapshot(data);
}
exportSnapshot().then(filePath => parentPort.postMessage({ filePath }))
    .catch(error => parentPort.postMessage({ error: error.message }));
