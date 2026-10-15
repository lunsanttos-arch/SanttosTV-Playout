"use strict";
// Blocking disk operations and JSON serialization deliberately live off PROGRAM's thread.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { parentPort, workerData } = require("node:worker_threads");
let document = workerData.initial;
let backupValid = workerData.backupValid;
const file = workerData.file;

function parentOf(parts) {
    let current = document;
    for (const part of parts.slice(0, -1)) current = current[part] ??= {};
    return [current, parts.at(-1)];
}
function apply(op) {
    if (op.type === "replace") { document = op.value; return; }
    const [parent, key] = parentOf(op.path);
    if (op.type === "set") { parent[key] = op.value; return; }
    const list = parent[key];
    if (!Array.isArray(list)) throw Error("Coleção de persistência inválida.");
    if (op.type === "upsertMany") {
        const indexes = new Map(list.map((value, index) => [value[op.key], index]));
        for (const value of op.value) {
            const id = value[op.key];
            if (indexes.has(id)) list[indexes.get(id)] = value;
            else { indexes.set(id, list.length); list.push(value); }
        }
        return;
    }
    const index = list.findIndex(item => item[op.key] === op.id);
    if (op.type === "remove") { if (index >= 0) list.splice(index, 1); }
    else if (op.type === "upsert") { if (index < 0) list.push(op.value); else list[index] = op.value; }
    else throw Error("Operação de persistência inválida.");
}
function syncFile(filePath) {
    const fd = fs.openSync(filePath, "r+");
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
async function rename(from, to) {
    for (let attempt = 0; ; attempt++) {
        try { fs.renameSync(from, to); return; }
        catch (error) {
            if (!["EBUSY", "EPERM", "EACCES"].includes(error.code) || attempt >= 3) throw error;
            await new Promise(resolve => setTimeout(resolve, [50, 150, 500][attempt]));
        }
    }
}
async function commit() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const backupTemp = temp + ".bak";
    try {
        const fd = fs.openSync(temp, "wx", 0o600);
        try { fs.writeFileSync(fd, JSON.stringify(document, null, 2), "utf8"); fs.fsyncSync(fd); }
        finally { fs.closeSync(fd); }
        if (backupValid && fs.existsSync(file)) {
            fs.copyFileSync(file, backupTemp); syncFile(backupTemp);
            await rename(backupTemp, file + ".bak");
        }
        await rename(temp, file);
        backupValid = true;
        // A successful ACK means the new file and its directory entry were synced.
        if (process.platform !== "win32") {
            const dir = fs.openSync(path.dirname(file), "r");
            try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
        }
    } finally {
        fs.rmSync(temp, { force: true }); fs.rmSync(backupTemp, { force: true });
    }
}
let tail = Promise.resolve();
parentPort.on("message", request => {
    tail = tail.then(async () => {
        try {
            for (const op of request.operations) apply(op);
            await commit();
            parentPort.postMessage({ revision: request.revision });
        } catch (error) {
            parentPort.postMessage({ revision: request.revision, error: error.message, code: error.code });
        }
    });
});
