"use strict";
// Fault injection only in a disposable test worker, never in the application.
const fs = require("node:fs");
const { parentPort, workerData } = require("node:worker_threads");
const originalSync = fs.fsyncSync;
const originalOpen = fs.openSync;
fs.fsyncSync = function (...args) {
    if (fs.existsSync(workerData.file + ".slow")) {
        parentPort.postMessage({ testPhase: "slow-disk" });
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 450);
    }
    return originalSync.apply(this, args);
};
fs.openSync = function (file, ...args) {
    for (const code of ["ENOSPC", "EACCES"]) {
        if (String(file).startsWith(workerData.file + ".") && String(file).endsWith(".tmp") && fs.existsSync(workerData.file + "." + code)) {
            const error = Error("Injected " + code); error.code = code; throw error;
        }
    }
    return originalOpen.call(this, file, ...args);
};
require("../../src/core/persistence/json-writer-worker");
