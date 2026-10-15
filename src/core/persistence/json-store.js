"use strict";
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { randomUUID } = require("node:crypto");
const stores = new Map();

class JsonStore {
    constructor(file, snapshot, { backupValid = true, maxPending = 2048, timeoutMs = 30000,
        workerFile = path.join(__dirname, "json-writer-worker.js"), onError = null } = {}) {
        if (!path.isAbsolute(file)) throw Error("Caminho de persistência deve ser absoluto.");
        Object.assign(this, { file, snapshot, backupValid, maxPending, timeoutMs, workerFile, onError });
        this.pending = new Map(); this.waiters = []; this.revision = 0; this.savedRevision = 0;
        this.worker = null; this.inFlight = null; this.error = null; this.fatal = false;
        this.termination = Promise.resolve(); this.closed = false;
    }
    enqueue(operation) {
        if (this.closed) throw Error("Persistência encerrada.");
        if (this.error) throw this.error;
        const key = operation.type === "replace" ? "root" : JSON.stringify([operation.path, operation.key, operation.id]);
        if (!this.pending.has(key) && this.pending.size >= this.maxPending) {
            this.fail(Error("Disco sem acompanhar as alterações; fila de gravação atingiu o limite."), true);
            throw this.error;
        }
        // Snapshot only the changed value, never serialize the entire history on PROGRAM.
        const copy = structuredClone(operation);
        if (operation.type === "replace") this.pending.clear();
        this.pending.delete(key); this.pending.set(key, copy);
        this.revision++;
        if (!this.scheduled) {
            this.scheduled = true;
            setImmediate(() => { this.scheduled = false; this.pump(); });
        }
        return this.revision;
    }
    replace(value) { return this.enqueue({ type: "replace", value }); }
    set(parts, value) { return this.enqueue({ type: "set", path: parts, value }); }
    upsert(parts, value, key = "id") { return this.enqueue({ type: "upsert", path: parts, key, id: value[key], value }); }
    upsertMany(parts, values, key = "id") {
        return this.enqueue({ type: "upsertMany", path: parts, key, id: randomUUID(), value: values });
    }
    remove(parts, id, key = "id") { return this.enqueue({ type: "remove", path: parts, key, id }); }
    start() {
        if (this.worker || this.closed) return;
        const worker = new Worker(this.workerFile, { workerData: {
            file: this.file, initial: this.snapshot(), backupValid: this.backupValid
        } });
        this.worker = worker;
        worker.on("message", result => {
            if (this.worker !== worker || result.revision !== this.inFlight?.revision) return;
            clearTimeout(this.timer); this.inFlight = null;
            if (result.error) { const error = Error(result.error); error.code = result.code; this.fail(error); return; }
            this.savedRevision = result.revision; this.backupValid = true;
            this.settle(); this.pump();
            if (!this.inFlight) worker.unref();
        });
        worker.on("error", error => { if (this.worker === worker) this.fail(error, true); });
        worker.on("exit", code => {
            if (this.worker === worker && !this.closed) this.fail(Error(`Serviço de gravação interrompido (${code}).`), true);
        });
        this.worker.unref();
    }
    pump() {
        if (this.error || this.closed || this.inFlight || this.savedRevision >= this.revision) return;
        try {
            this.start();
            this.worker.ref();
            this.inFlight = { revision: this.revision };
            const operations = [...this.pending.values()]; this.pending.clear();
            this.timer = setTimeout(() => this.fail(Error("Gravação excedeu o tempo limite. Confira o disco."), true), this.timeoutMs);
            this.worker.postMessage({ revision: this.inFlight.revision, operations });
        } catch (error) { this.fail(error, true); }
    }
    fail(error, fatal = false) {
        clearTimeout(this.timer); this.inFlight = null; this.error = error; this.fatal ||= fatal;
        if (fatal && this.worker) {
            const worker = this.worker; this.worker = null;
            this.termination = worker.terminate();
        } else this.worker?.unref();
        this.settle();
        if (this.onError) this.onError(error);
        else console.error(`Falha de gravação (${path.basename(this.file)}):`, error.message);
    }
    settle() {
        this.waiters = this.waiters.filter(waiter => {
            if (this.error) { waiter.reject(this.error); return false; }
            if (waiter.target <= this.savedRevision) { waiter.resolve(); return false; }
            return true;
        });
    }
    flush() {
        if (this.error) return Promise.reject(this.error);
        const target = this.revision;
        if (target <= this.savedRevision) return Promise.resolve();
        // At most one ACK barrier for the active batch and one for the pending
        // batch, even when many checkpoints overwrite the same queued value.
        let waiter = this.waiters.find(item => item.target === target || item.target > (this.inFlight?.revision ?? Infinity));
        if (waiter) waiter.target = Math.max(waiter.target, target);
        else {
            waiter = { target };
            waiter.promise = new Promise((resolve, reject) => Object.assign(waiter, { resolve, reject }));
            this.waiters.push(waiter);
        }
        this.pump(); return waiter.promise;
    }
    async retry() {
        if (!this.error) return this.flush();
        await this.termination;
        if (!this.error) return this.flush();
        // Rebuild from the authoritative model, including any mutation attempted
        // while a previous disk failure was being reported.
        this.pending.clear(); this.pending.set("root", { type: "replace", value: structuredClone(this.snapshot()) });
        this.revision++;
        this.error = null; this.fatal = false;
        return this.flush();
    }
    async close() {
        await this.flush(); this.closed = true;
        if (this.worker) { const worker = this.worker; this.worker = null; await worker.terminate(); }
    }
    get dirty() { return this.revision > this.savedRevision; }
}

function openJsonStore(file, snapshot, options) {
    const previous = stores.get(file);
    if (previous?.dirty) throw Error("Aguarde a confirmação de gravação antes de recarregar os dados.");
    if (previous?.error) throw previous.error;
    if (previous) void previous.close();
    const store = new JsonStore(file, snapshot, options); stores.set(file, store);
    store.start(); return store;
}
async function flushPersistence({ retry = false } = {}) {
    const results = await Promise.allSettled([...stores.values()].map(store => retry ? store.retry() : store.flush()));
    const failed = results.find(result => result.status === "rejected");
    if (failed) throw failed.reason;
}
async function closePersistence() {
    await flushPersistence(); await Promise.all([...stores.values()].map(store => store.close())); stores.clear();
}
function persistenceStatus() {
    return [...stores.values()].filter(store => store.error).map(store => ({ file: path.basename(store.file), error: store.error.message }));
}
module.exports = { JsonStore, openJsonStore, flushPersistence, closePersistence, persistenceStatus };
