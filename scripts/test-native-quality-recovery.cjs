"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createRecoveryFixture } = require("./h264-recovery-fixture");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "santtos-native-recovery-"));
    const pages = await (await fetch("http://127.0.0.1:9333/json")).json();
    const ws = new WebSocket(pages.find(page => page.type === "page").webSocketDebuggerUrl);
    await new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));
    let serial = 0; const pending = new Map();
    ws.addEventListener("message", event => { const result = JSON.parse(event.data); pending.get(result.id)?.(result); pending.delete(result.id); });
    async function call(method, ...args) {
        const id = ++serial; const reply = new Promise(resolve => pending.set(id, resolve));
        ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: `window.santtosAPI.${method}(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true } }));
        const result = await reply; if (result.result.exceptionDetails) throw Error(result.result.exceptionDetails.exception?.description); return result.result.result.value;
    }
    async function until(check) { for (let n = 0; n < 200; n++) { const result = await check(); if (result) return result; await wait(50); } throw Error("Recovery condition timeout"); }
    try {
        assert((await call("getNdiStatus")).devNullSink);
        const file = path.join(folder, "recoverable.mp4"); createRecoveryFixture(file);
        const imported = await call("importRundownFiles", [file]); const item = imported.media[0]; assert(item);
        const date = "2030-01-01";
        await call("saveDailyRundown", { date, title: "Recovery test", startTime: "00:00", items: [{ ...item, sourceMediaId: item.id, rundownItemId: "recoverable" }] });
        const checked = await until(async () => { const saved = await call("getDailyRundown", date); return saved.items[0]?.quality?.status === "approved" && saved.items[0]; });
        assert(checked.quality.warning);
        const normal = (await call("getMedia"))[0];
        const queue = [{ ...checked, id: "recovered-onair", outPoint: 2 }, { ...normal, sourceMediaId: normal.id, id: "normal-next", outPoint: 3 }];
        assert.equal((await call("applyNativeRundown", queue)).ok, true);
        assert.equal((await call("playNdiFile", item.path, 0, "", { itemId: "recovered-onair", outPointSeconds: 2 })).ok, true);
        const active = await until(async () => { const s = await call("getNdiStatus"); return s.playout?.state === "PLAYING" && s.playout.itemId === "recovered-onair" && s.playout.positionSeconds > .2 && s; });
        let command = execFileSync("ps", ["-p", String(active.decks.active.pid), "-o", "args="], { encoding: "utf8" });
        assert(!command.includes("-xerror")); assert(command.includes("-err_detect careful"));
        const next = await until(async () => { const s = await call("getNdiStatus"); return s.playout?.state === "PLAYING" && s.playout.itemId === "normal-next" && s; });
        command = execFileSync("ps", ["-p", String(next.decks.active.pid), "-o", "args="], { encoding: "utf8" });
        assert(command.includes("-xerror")); assert(command.includes("-err_detect explode"));
        await call("stopNdiFile");
        console.log("Native recovery: one-off approved with warning, actual PROGRAM plays recovered H.264 and advances; next normal decoder retains strict flags.");
    } finally { ws.close(); fs.rmSync(folder, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
