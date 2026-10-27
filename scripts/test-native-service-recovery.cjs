"use strict";
const assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs");
const root = process.env.SANTTOS_QA_USERDATA;
if (!root?.includes("santtos-native-qa-")) throw Error("Use a disposable native QA profile.");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws, oldPid, serial = 0; const pending = new Map();
async function evaluate(expression) {
    const id = ++serial; let timer;
    const promise = new Promise(resolve => pending.set(id, resolve));
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
    try {
        const reply = await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("Service recovery inspector timeout")), 10000); })]);
        if (reply.error || reply.result?.exceptionDetails) throw Error("Service recovery API failed");
        return reply.result.result.value;
    } finally { clearTimeout(timer); pending.delete(id); }
}
(async () => {
    const pages = await (await fetch("http://127.0.0.1:19334/json")).json(); ws = new WebSocket(pages[0].webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
    ws.addEventListener("message", event => { const reply = JSON.parse(event.data); pending.get(reply.id)?.(reply); });
    const file = path.resolve(__dirname, "../src/main/main.js");
    const client = `process.getBuiltinModule('node:module').createRequire(${JSON.stringify(file)})(${JSON.stringify(file)}).programService`;
    const call = (channel, args = []) => evaluate(`${client}.call(${JSON.stringify(channel)},${JSON.stringify(args)})`);
    const initial = await call("ndi:status"); assert(initial.devNullSink && !initial.testBench); const prior = await call("timeline:list");
    try {
        const source = (await call("media:list"))[0]; assert(source?.duration >= 20);
        await call("ndi:stop-file");
        const item = { ...source, id: "service-resume", sourceMediaId: source.id, inPoint: 0, outPoint: 40, loop: true, freezeEnd: false };
        await call("playout:apply-rundown", [[item]]);
        await call("ndi:play-file", [source.path, 0, "", { itemId: item.id, inPointSeconds: 0, outPointSeconds: 40, loop: true }]);
        await wait(1500); const saved = await call("playout:recovery"); assert(saved?.playing && saved.positionSeconds > .5);
        oldPid = (await call("ndi:status")).service.pid; assert(Number.isInteger(oldPid) && oldPid > 0);
        process.kill(oldPid, "SIGSTOP"); // Only the dedicated service belonging to this disposable app.
        let newPid;
        for (let n = 0; n < 55; n++) { newPid = await evaluate(`${client}.pid`); if (newPid && newPid !== oldPid) break; await wait(500); }
        assert(newPid && newPid !== oldPid, "Supervisor must replace an unresponsive PROGRAM process");
        let resumed;
        for (let n = 0; n < 40; n++) { const state = await call("ndi:status"); if (state.playout.itemId === item.id && state.playout.state === "PLAYING") { resumed = state; break; } await wait(100); }
        assert(resumed, "PROGRAM must restore the occurrence without UI Play");
        assert(resumed.playout.positionSeconds >= saved.positionSeconds - .1 && resumed.playout.positionSeconds < saved.positionSeconds + 5);
        await call("service:flush");
        const entries = JSON.parse(fs.readFileSync(path.join(root, "reporting/playout-report-state.json"), "utf8")).entries;
        assert(entries.some(entry => entry.occurrenceId === item.id && entry.status === "INTERROMPIDO" && entry.recoveredAfterCrash && entry.endedAtUnknown));
        console.log("NATIVE SERVICE RECOVERY: SIGSTOP isolated service, heartbeat timeout/forced termination, automatic new PID, checkpoint position and interrupted-airing report passed");
    } finally {
        if (oldPid) try { process.kill(oldPid, "SIGKILL"); } catch {}
        await call("ndi:stop-file").catch(() => {}); await call("timeline:save", [prior]).catch(() => {});
    }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => ws?.close());
