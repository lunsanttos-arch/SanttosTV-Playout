"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { flushPersistence, closePersistence } = require("../src/core/persistence/json-store");
const db = require("../src/database/database");
const reports = require("../src/core/reporting/playout-report");
const library = require("../src/core/library/library-categories");
const inputs = require("../src/core/library/web-inputs");
const { OperationSettings } = require("../src/core/playout/operation-settings");
const { PlayoutRecovery } = require("../src/core/playout/playout-recovery");
const { DataBackupService, decodeBackup } = require("../src/core/backup/data-backup");
const { SchedulingWebController } = require("../src/core/scheduling/web-controller");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "santtos-persistence-integration-"));
    let backup, controller;
    try {
        db.initializeDatabase({ userDataPath: root, migrateLegacy: false });
        reports.initializePlayoutReports({ userDataPath: root, documentsPath: root });
        library.initializeLibraryCategories(root); inputs.initializeWebInputs(root);
        const operation = new OperationSettings(root), recovery = new PlayoutRecovery(root);
        operation.update({ stallSeconds: 10 });
        await recovery.saveAsync({ itemId: "clip", positionSeconds: 1, playing: true });
        await flushPersistence();

        // Any accidental synchronous write on the application thread fails this test.
        const methods = ["writeFileSync", "fsyncSync", "copyFileSync", "renameSync", "mkdirSync"];
        const originals = new Map(methods.map(name => [name, fs[name]]));
        try {
            for (const name of methods) fs[name] = () => { throw Error("Main thread must not call " + name); };
            db.addLog("Persistência fora do PROGRAM");
            db.updateHashtagStyle({ ...db.getSettings().hashtagStyle, fontSize: 35 });
            db.saveDailyRundown({ date: "2026-10-15", title: "Gravação isolada", items: [{ placeholder: true, name: "Filme", duration: 1800 }] });
            db.saveWeeklyRundown(4, { title: "Quinta", items: [] });
            library.saveLibraryCategories(library.getLibraryCategories());
            inputs.saveWebInput({ name: "Live", url: "https://example.org/live.m3u8" });
            operation.update({ stallSeconds: 12 });
            const entry = reports.startPlayoutEntry({ id: "clip", name: "006 AGENCIA EURO.mp4", duration: 30 });
            reports.markPlayoutEntryReady(entry.id);
            reports.finishPlayoutEntry(entry.id, "PULADO_POR_ERRO", 3, { reason: "Decoder corrompido" });
            reports.updatePlayoutEntrySuccessor(entry.id, "Próximo programa");
            await recovery.saveAsync({ itemId: "clip", positionSeconds: 3, playing: false });
            await flushPersistence();
        } finally { for (const [name, original] of originals) fs[name] = original; }

        const databaseFile = path.join(root, "database/santtos-tv.json");
        const persisted = JSON.parse(fs.readFileSync(databaseFile, "utf8"));
        assert.equal(persisted.settings.hashtagStyle.fontSize, 35);
        assert.equal(persisted.dailyRundowns["2026-10-15"].title, "Gravação isolada");
        const history = JSON.parse(fs.readFileSync(path.join(root, "reporting/playout-report-state.json"), "utf8"));
        assert.equal(history.entries.length, 1); assert.equal(history.entries[0].nextContent, "Próximo programa");
        assert(history.entries[0].actualStartedAt); assert.equal(history.entries[0].contentCode, "006");

        // Backup must include the pending latest edit, even without an explicit caller flush.
        backup = new DataBackupService(root, "qa", () => flushPersistence());
        db.saveDailyRundown({ date: "2026-10-15", title: "Última alteração antes do backup", items: [] });
        const archive = await backup.run("create");
        const snapshot = decodeBackup(archive.file);
        assert.equal(JSON.parse(snapshot.files.get("database/santtos-tv.json")).dailyRundowns["2026-10-15"].title,
            "Última alteração antes do backup");
        let releaseBackup, enteredBackup;
        const entered = new Promise(resolve => { enteredBackup = resolve; });
        const blockedBackup = new DataBackupService(root, "qa", () => {
            enteredBackup(); return new Promise(resolve => { releaseBackup = resolve; });
        });
        const canceled = assert.rejects(blockedBackup.run("create"), /encerramento/);
        await entered; blockedBackup.stop(); releaseBackup(); await canceled;
        assert.equal(blockedBackup.workers.size, 0, "A stopped backup must not spawn after the persistence barrier completes");

        // HTTP success must wait for the persistence barrier; failure cannot return ok:true.
        controller = new SchedulingWebController({ port: 0, distFolder: root,
            getMedia: db.getMedia, getRundown: db.getDailyRundown, saveRundown: db.saveDailyRundown, commit: flushPersistence });
        const status = await controller.start(), base = `http://127.0.0.1:${status.port}`;
        const login = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: status.pin }) });
        const headers = { "Content-Type": "application/json", Cookie: login.headers.get("set-cookie").split(";")[0] };
        let release, calls = 0, responded = false;
        const gate = new Promise(resolve => { release = resolve; });
        controller.commit = async options => { await flushPersistence(options); if (++calls === 2) await gate; };
        const request = fetch(base + "/api/rundown", { method: "POST", headers,
            body: JSON.stringify({ date: "2026-10-16", title: "Aguardar confirmação", items: [] }) }).then(response => { responded = true; return response; });
        try {
            for (let n = 0; n < 100 && calls < 2; n++) await delay(10);
            assert.equal(calls, 2); assert.equal(responded, false, "HTTP replied before durable commit");
        } finally { release(); }
        assert.equal((await request).status, 200);
        calls = 0;
        controller.commit = async () => { if (++calls === 2) throw Error("Disco indisponível"); };
        const failed = await fetch(base + "/api/rundown", { method: "POST", headers,
            body: JSON.stringify({ date: "2026-10-17", title: "Sem falso sucesso", items: [] }) });
        assert.notEqual(failed.status, 200); assert.equal((await failed.json()).ok, false);

        await reports.listReportFiles();
        console.log("PERSISTENCE INTEGRATION: no synchronous application-thread writes, existing JSON schema, report/clock metadata, backup drain and HTTP durability/failure barriers passed");
    } finally {
        controller?.stop(); backup?.stop();
        await closePersistence();
        fs.rmSync(root, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
