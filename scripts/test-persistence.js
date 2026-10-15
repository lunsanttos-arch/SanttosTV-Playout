"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { JsonStore } = require("../src/core/persistence/json-store");
const { FramePacer } = require("../src/core/playout/frame-pacer");
const { PlayoutRecovery } = require("../src/core/playout/playout-recovery");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const fixture = path.join(__dirname, "fixtures/persistence-fault-worker.js");
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));

(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "santtos-writer-qa-"));
    const stores = [], pacers = [];
    function create(name, model, options = {}) {
        const store = new JsonStore(path.join(root, name), () => model, { workerFile: fixture, onError: () => {}, ...options });
        stores.push(store); return store;
    }
    try {
        // A slow fsync in the writer must not hold PROGRAM's event loop.
        const model = { value: 1, entries: [] }, store = create("slow.json", model);
        fs.writeFileSync(store.file + ".slow", "");
        store.replace(model);
        const saved = store.flush();
        await new Promise(resolve => store.worker.on("message", message => { if (message.testPhase) resolve(); }));
        let ticks = 0, frames = 0, ack = false;
        const timer = setInterval(() => ticks++, 10);
        const pacer = new FramePacer({ profile: { fpsN: 25, fpsD: 1, frameSize: 1024 },
            source: { pause() {}, resume() {} }, reserveMs: 0, onFrame: () => frames++ });
        pacers.push(pacer);
        for (let n = 0; n < 20; n++) pacer.push(Buffer.alloc(1));
        saved.then(() => { ack = true; });
        await delay(250); clearInterval(timer);
        assert(ticks >= 8 && frames >= 3, `Writer blocked PROGRAM: ticks=${ticks}, frames=${frames}`);
        assert.equal(ack, false, "Must not acknowledge before fsync completes");
        await saved; assert.equal(read(store.file).value, 1);
        fs.unlinkSync(store.file + ".slow"); pacer.stop();

        // Large burst: values are snapshotted, order is preserved, ACKs coalesce.
        const waiting = [];
        for (let n = 0; n < 1000; n++) {
            model.value = n; store.set(["value"], model.value); waiting.push(store.flush());
            assert(store.pending.size <= 1 && store.waiters.length <= 2);
        }
        await Promise.all(waiting); assert.equal(read(store.file).value, 999);
        const entry = { id: "one", name: "original" };
        model.entries.push(entry); store.upsert(["entries"], entry); entry.name = "changed after enqueue";
        await store.flush(); assert.equal(read(store.file).entries[0].name, "original");
        store.upsert(["entries"], entry); model.entries.splice(0); store.remove(["entries"], "one");
        await store.flush(); assert.equal(read(store.file).entries.length, 0);
        const batch = Array.from({ length: 3000 }, (_, n) => ({ id: String(n), name: "Media " + n }));
        model.entries.push(...batch); store.upsertMany(["entries"], batch);
        await store.flush(); assert.equal(read(store.file).entries.length, 3000);
        model.entries[42].name = "Updated"; store.upsertMany(["entries"], [model.entries[42]]);
        await store.flush(); assert.equal(read(store.file).entries[42].name, "Updated");

        // Disk full / permission denied: old data remains valid, success is withheld,
        // and retry includes in-memory changes attempted after the failure.
        for (const code of ["ENOSPC", "EACCES"]) {
            const previous = read(store.file).value;
            fs.writeFileSync(store.file + "." + code, "");
            model.value++; store.set(["value"], model.value);
            await assert.rejects(store.flush(), error => error.code === code);
            assert.equal(read(store.file).value, previous);
            model.value++; assert.throws(() => store.set(["value"], model.value));
            fs.unlinkSync(store.file + "." + code);
            await store.retry(); assert.equal(read(store.file).value, model.value);
            assert.equal(read(store.file + ".bak").value, previous);
        }

        // Writer dies in the middle of a write: only the old committed file is visible.
        fs.writeFileSync(store.file + ".slow", "");
        const previous = read(store.file).value;
        model.value++; store.set(["value"], model.value);
        const rejected = assert.rejects(store.flush(), /interrompido/);
        await new Promise(resolve => store.worker.once("message", resolve));
        await store.worker.terminate(); await rejected;
        assert.equal(read(store.file).value, previous);
        fs.unlinkSync(store.file + ".slow"); await store.retry();
        assert.equal(read(store.file).value, model.value);

        // Backlog overflow is explicit and recoverable, not unbounded growth.
        const smallModel = { a: 0, b: 0, c: 0 }, small = create("bounded.json", smallModel, { maxPending: 2 });
        fs.writeFileSync(small.file + ".slow", ""); small.replace(smallModel);
        const overflow = assert.rejects(small.flush(), /limite/);
        await new Promise(resolve => small.worker.once("message", resolve));
        smallModel.a = 1; small.set(["a"], 1); smallModel.b = 2; small.set(["b"], 2);
        smallModel.c = 3; assert.throws(() => small.set(["c"], 3), /limite/);
        await overflow; assert(small.pending.size <= 2);
        fs.unlinkSync(small.file + ".slow"); await small.retry();
        assert.deepEqual(read(small.file), smallModel);

        const recovery = new PlayoutRecovery(path.join(root, "recovery"));
        recovery.store = new JsonStore(recovery.file, () => recovery.pendingState ?? recovery.state,
            { workerFile: fixture, backupValid: false, onError: () => {} });
        stores.push(recovery.store);
        await recovery.saveAsync({ itemId: "on-air", positionSeconds: 1, playing: true });
        fs.writeFileSync(recovery.file + ".ENOSPC", "");
        await assert.rejects(recovery.saveAsync({ itemId: "on-air", positionSeconds: 2, playing: true }));
        let checkpoint;
        assert.doesNotThrow(() => { checkpoint = recovery.captureNativeAsync({ itemId: "on-air", positionSeconds: 3, state: "PLAYING" }); });
        await assert.rejects(checkpoint);
        assert.equal(recovery.state.positionSeconds, 1, "Uncommitted checkpoint must not be advertised as saved");
        fs.unlinkSync(recovery.file + ".ENOSPC");
        await recovery.captureNativeAsync({ itemId: "on-air", positionSeconds: 4, state: "PLAYING" });
        assert.equal(recovery.state.positionSeconds, 4);
        assert.equal(read(recovery.file).positionSeconds, 4);

        const timedModel = { value: 1 }, timed = create("timeout.json", timedModel, { timeoutMs: 100 });
        fs.writeFileSync(timed.file + ".slow", ""); timed.replace(timedModel);
        await assert.rejects(timed.flush(), /tempo limite/);
        fs.unlinkSync(timed.file + ".slow"); await timed.retry();
        assert.equal(read(timed.file).value, 1);

        console.log(`PERSISTENCE QA: slow fsync isolated (${ticks} UI ticks / ${frames} PROGRAM frames), ordered/coalesced ACKs, bulk import, snapshots, ENOSPC/EACCES, writer death/timeout, bounded backlog and safe checkpoint retry passed`);
    } finally {
        for (const pacer of pacers) pacer.stop();
        await Promise.all(stores.map(store => store.close()));
        fs.rmSync(root, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
