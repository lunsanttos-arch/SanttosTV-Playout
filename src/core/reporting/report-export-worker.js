"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const { writeReportSnapshot } = require("./playout-report");
writeReportSnapshot(workerData).then(filePath => parentPort.postMessage({ filePath }))
    .catch(error => parentPort.postMessage({ error: error.message }));
