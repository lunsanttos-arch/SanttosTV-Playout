"use strict";
// Fault injection is restricted to the disposable profile created by native QA.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const root = process.env.SANTTOS_QA_USERDATA;
if (!root || !path.isAbsolute(root) || !root.includes("santtos-native-qa-")) throw Error("Use only the disposable native QA userData.");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws, serial = 0; const pending = new Map();
async function evaluate(expression) {
    const id = ++serial; let timer;
    const response = new Promise(resolve => pending.set(id, resolve));
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
    try {
        const reply = await Promise.race([response, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("Persistence QA CDP timeout")), 10000); })]);
        if (reply.error || reply.result?.exceptionDetails) throw Error("Electron persistence API failed");
        return reply.result.result.value;
    } finally { clearTimeout(timer); pending.delete(id); }
}
(async () => {
    const pages = await (await fetch("http://127.0.0.1:9333/json")).json();
    ws = new WebSocket(pages.find(page => page.type === "page").webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
    ws.addEventListener("message", event => { const reply = JSON.parse(event.data); pending.get(reply.id)?.(reply); });
    const initial = await evaluate("window.santtosAPI.getNdiStatus()");
    assert(initial.devNullSink && !initial.testBench, "NDI must be DEV NULL in the isolated QA profile");
    const timeline = await evaluate("window.santtosAPI.getTimeline()");
    const source = (await evaluate("window.santtosAPI.getMedia()"))[0]; assert(source?.duration >= 20);
    const style = (await evaluate("window.santtosAPI.getSettings()")).hashtagStyle;
    const nextStyle = { ...style, fontSize: style.fontSize === 35 ? 36 : 35 };
    const databaseFolder = path.join(root, "database"), held = databaseFolder + ".qa-offline";
    let displaced = false;
    try {
        await evaluate("window.santtosAPI.stopNdiFile()");
        const item = { ...source, id: "persistence-on-air", sourceMediaId: source.id, inPoint: 0, outPoint: 40, loop: true, freezeEnd: false };
        assert((await evaluate(`window.santtosAPI.applyNativeRundown(${JSON.stringify([item])})`)).ok);
        await evaluate(`window.santtosAPI.playNdiFile(${JSON.stringify(source.path)},0,'',${JSON.stringify({ itemId: item.id, inPointSeconds: 0, outPointSeconds: 40, loop: true })})`);
        assert((await evaluate(`window.santtosAPI.saveHashtagStyle(${JSON.stringify(style)})`)).ok);
        const before = await evaluate("window.santtosAPI.getNdiStatus()"); assert.equal(before.playout.state, "PLAYING");
        // Preserve the real database, then make its directory unavailable to the writer.
        assert(!fs.existsSync(held)); fs.renameSync(databaseFolder, held); displaced = true;
        fs.writeFileSync(databaseFolder, "QA: unavailable database directory");
        const failed = await evaluate(`window.santtosAPI.saveHashtagStyle(${JSON.stringify(nextStyle)})`);
        assert.equal(failed.ok, false, "IPC must not report saved when the disk write failed");
        assert(failed.error);
        let banner = false;
        for (let n = 0; n < 30; n++) { banner = await evaluate("Boolean(document.querySelector('.persistence-error'))"); if (banner) break; await wait(100); }
        assert(banner, "An automatic write failure must be visible to the operator");
        const during = await evaluate("window.santtosAPI.getNdiStatus()");
        assert(during.persistenceError); assert.equal(during.playout.state, "PLAYING");
        assert.equal(during.playout.generation, before.playout.generation);
        const diagnostics = await evaluate("window.santtosAPI.getOperationSettings()");
        assert(diagnostics.diagnostics.frameAgeMs < 1000, "PROGRAM must continue delivering frames during the disk fault");
        fs.unlinkSync(databaseFolder); fs.renameSync(held, databaseFolder); displaced = false;
        assert((await evaluate(`window.santtosAPI.saveHashtagStyle(${JSON.stringify(nextStyle)})`)).ok);
        assert.equal(JSON.parse(fs.readFileSync(path.join(databaseFolder, "santtos-tv.json"), "utf8")).settings.hashtagStyle.fontSize, nextStyle.fontSize);
        const recovered = await evaluate("window.santtosAPI.getNdiStatus()");
        assert.equal(recovered.persistenceError, null); assert.equal(recovered.playout.generation, before.playout.generation);
        console.log("NATIVE PERSISTENCE: real IPC failure with unavailable disk, visible alert, uninterrupted PROGRAM generation/frames and durable retry passed");
    } finally {
        if (displaced) { fs.rmSync(databaseFolder, { force: true }); fs.renameSync(held, databaseFolder); }
        await evaluate(`window.santtosAPI.saveHashtagStyle(${JSON.stringify(style)})`);
        await evaluate("window.santtosAPI.stopNdiFile()");
        await evaluate(`window.santtosAPI.saveTimeline(${JSON.stringify(timeline)})`);
    }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => ws?.close());
