"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const db = require("../src/database/database");
const { SchedulingWebController } = require("../src/core/scheduling/web-controller");

(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "santtos-controller-qa-"));
    const controller = new SchedulingWebController({ port: 0, distFolder: root,
        getMedia: db.getMedia, getRundown: db.getDailyRundown, saveRundown: db.saveDailyRundown, getWeekly: db.getWeeklyRundown, saveWeekly: db.saveWeeklyRundown });
    try {
        db.initializeDatabase({ userDataPath: root, migrateLegacy: false });
        fs.writeFileSync(path.join(root, "controller.html"), "<!doctype html><title>Programação</title>");
        const first = db.saveDailyRundown({ date: "2026-10-13", expectedUpdatedAt: null, items: [
            { placeholder: true, rundownItemId: "slot-1", name: "Filme a definir", duration: 3600, notes: "Master substitui" }
        ] });
        assert.equal(first.items.length, 1); assert.equal(first.items[0].placeholder, true);
        assert.equal(first.items[0].duration, 3600);
        const mediaPath = path.join(root, "filme.mp4"); fs.writeFileSync(mediaPath, Buffer.alloc(100));
        const media = db.addMedia([mediaPath]).importedItems[0];
        const updated = db.saveDailyRundown({ ...first, expectedUpdatedAt: first.updatedAt,
            items: [{ ...media, rundownItemId: "slot-1", sourceMediaId: media.id, replacedPlaceholder: true, outPoint: 60 }] });
        assert.equal(updated.items[0].rundownItemId, "slot-1");
        assert.notEqual(updated.items[0].placeholder, true);
        assert.equal(updated.items[0].replacedPlaceholder, true);
        assert.equal(db.getDailyRundown(updated.date).items[0].replacedPlaceholder, true);
        assert.throws(() => db.saveDailyRundown({ ...first, expectedUpdatedAt: null }), /outro operador/);
        const live = db.saveDailyRundown({ date: "2026-10-15", items: [
            { placeholder: true, liveSlot: true, rundownItemId: "live-1", name: "", duration: 600 },
            { placeholder: true, rundownItemId: "pending-1", name: "", duration: 1200 }
        ] });
        assert.equal(live.items[0].name, "");
        assert.equal(live.items[0].liveSlot, true);
        assert.equal(live.items[1].liveSlot, false);
        const timeline = db.saveTimeline([{ ...live.items[0], id: "live-on-air" }]);
        assert.equal(timeline.length, 1);
        assert.equal(timeline[0].liveSlot, true);
        assert.equal(timeline[0].name, "Ao Vivo");
        assert.equal(timeline[0].outPoint, 600);
        for (let day = 0; day < 7; day++) {
            const template = db.saveWeeklyRundown(day, { title: `Modelo ${day}`, startTime: "06:30", items: [...live.items, updated.items[0]] });
            assert.equal(template.exists, true); assert.equal(template.items.length, 3);
            assert.equal(template.items[0].liveSlot, true); assert.equal(template.items[2].replacedPlaceholder, true);
        }
        db.initializeDatabase({ userDataPath: root, migrateLegacy: false });
        const weekly = db.getWeeklyRundown(3);
        assert.equal(weekly.title, "Modelo 3"); assert.equal(weekly.startTime, "06:30"); assert.equal(weekly.items.length, 3);
        assert.throws(() => db.getWeeklyRundown(7), /inválido/);
        assert.throws(() => db.saveWeeklyRundown(3, { ...weekly, expectedUpdatedAt: null }), /outro operador/);
        const status = await controller.start();
        const base = `http://127.0.0.1:${status.port}`;
        assert.equal((await fetch(base + "/api/media")).status, 401);
        const login = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pin: status.pin }) });
        assert.equal(login.status, 200);
        const cookie = login.headers.get("set-cookie").split(";")[0];
        assert(login.headers.get("set-cookie").includes("HttpOnly"));
        const headers = { Cookie: cookie, "Content-Type": "application/json" };
        const response = await fetch(base + "/api/rundown?date=2026-10-13", { headers });
        assert.equal((await response.json()).items[0].sourceMediaId, media.id);
        const save = await fetch(base + "/api/rundown", { method: "POST", headers,
            body: JSON.stringify({ date: "2026-10-14", expectedUpdatedAt: null, items: [{ placeholder: true, name: "Série", duration: 1200 }] }) });
        assert.equal(save.status, 200); assert.equal(db.getDailyRundown("2026-10-14").items[0].placeholder, true);
        const remoteWeekly = await fetch(base + "/api/weekly?weekday=3", { headers });
        assert.equal((await remoteWeekly.json()).items[0].liveSlot, true);
        const newWeekly = await fetch(base + "/api/weekly", { method: "POST", headers, body: JSON.stringify({ weekday: 2, rundown: { title: "Terça remota", startTime: "08:00", items: live.items } }) });
        assert.equal(newWeekly.status, 200); assert.equal(db.getWeeklyRundown(2).title, "Terça remota");
        assert.equal((await fetch(base + "/api/weekly?weekday=9", { headers })).status, 400);
        assert.equal((await fetch(base + "/api/weekly")).status, 401);
        const htmlExport = await fetch(base + "/api/rundown/html", { method: "POST", headers, body: JSON.stringify({ ...live, title: '<script>alert(1)</script>' }) });
        assert.equal(htmlExport.status, 200); assert(htmlExport.headers.get('content-type').includes('text/html'));
        const html = await htmlExport.text(); assert(html.includes('&lt;script&gt;')); assert(!html.includes('<script>'));
        assert.equal((await fetch(base + "/api/apply", { method: "POST", headers, body: "{}" })).status, 404);
        assert.equal((await fetch(base + "/api/rundown", { method: "POST", headers: { ...headers, Origin: "http://outro-site" }, body: "{}" })).status, 403);
        assert.equal((await fetch(base + "/controller")).status, 200);
        assert.equal((await fetch(base + "/database/santtos-tv.json")).status, 404);
        console.log("CONTROLLER QA: APROVADO — autenticação, rascunho remoto, espaços vazios, substituição e conflito entre operadores.");
    } finally { controller.stop(); fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
