"use strict";
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
    const pages = await (await fetch("http://127.0.0.1:9333/json")).json();
    const ws = new WebSocket(pages.find(page => page.type === "page").webSocketDebuggerUrl);
    await new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));
    let serial = 0; const pending = new Map();
    ws.addEventListener("message", event => { const reply = JSON.parse(event.data); pending.get(reply.id)?.(reply); });
    async function send(method, params) {
        const id = ++serial; let timer;
        const result = new Promise(resolve => pending.set(id, resolve));
        ws.send(JSON.stringify({ id, method, params }));
        try { return await Promise.race([result, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("Library QA timeout")), 15000); })]); }
        finally { clearTimeout(timer); pending.delete(id); }
    }
    async function evaluate(expression) {
        const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (reply.result.exceptionDetails) throw Error(reply.result.exceptionDetails.exception?.description);
        return reply.result.result.value;
    }
    const call = (method, ...args) => evaluate(`window.santtosAPI.${method}(...${JSON.stringify(args)})`);
    let prior, operation, categories;
    try {
        assert((await call("getNdiStatus")).devNullSink, "Only the disposable DEV NULL profile");
        prior = await call("getTimeline"); operation = (await call("getOperationSettings")).settings;
        const media = (await call("getMedia"))[0]; assert.equal(media.quality.loudness.status, "measured");
        categories = await call("getLibraryCategories");
        assert((await call("saveLibraryCategories", [...categories, { id: "qa-watch", name: "QA Watch", folderPath: path.dirname(media.path), builtIn: false }])).ok);
        await evaluate("window.dispatchEvent(new CustomEvent('santtos:library-categories-updated'))");
        assert.equal((await call("getLibraryWatchSource", "not-imported")).ok, false);
        assert.equal((await call("openLibraryFile", "not-imported")).ok, false);
        await call("saveOperationSettings", { ...operation, audioLevelingEnabled: true });
        await call("stopNdiFile");
        const item = { ...media, id: "library-watch-on-air", sourceMediaId: media.id, inPoint: 0, outPoint: 40, loop: true, freezeEnd: false };
        await call("applyNativeRundown", [item]);
        await call("playNdiFile", media.path, 0, "", { itemId: item.id, inPointSeconds: 0, outPointSeconds: 40, loop: true });
        const before = await call("getNdiStatus"), queue = await call("getTimeline");
        let args = execFileSync("ps", ["-p", String(before.decks.active.pid), "-o", "args="], { encoding: "utf8" });
        assert(args.includes("alimiter=") && args.includes("volume="), "Measured leveling must run in the common decoder");
        await evaluate("document.querySelector('.library-module-switch button').click()");
        for (let n = 0; n < 80; n++) { if (await evaluate("[...document.querySelectorAll('.media-item button')].some(button=>button.textContent==='Assistir')")) break; await wait(100); }
        await evaluate("(()=>{const button=[...document.querySelectorAll('.media-item button')].find(button=>button.textContent==='Assistir');button.focus();button.click();})()");
        let ready = false;
        for (let n = 0; n < 80; n++) { ready = await evaluate("Boolean(document.querySelector('.library-watch-dialog video')?.readyState>=2)"); if (ready) break; await wait(100); }
        assert(ready, "The independent library player must decode the fixture");
        await evaluate("(()=>{const v=document.querySelector('.library-watch-dialog video');v.pause();v.currentTime=2;v.volume=.2;})()");
        await wait(300);
        const after = await call("getNdiStatus");
        assert.equal(after.playout.generation, before.playout.generation);
        assert.equal(after.decks.active.pid, before.decks.active.pid);
        assert.equal(after.playout.state, "PLAYING");
        assert.deepEqual((await call("getTimeline")).map(i => i.id), queue.map(i => i.id));
        await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await wait(100); assert.equal(await evaluate("Boolean(document.querySelector('.library-watch-dialog'))"), false);
        assert.equal(await evaluate("document.activeElement?.textContent"), "Assistir");
        await call("saveOperationSettings", { ...operation, audioLevelingEnabled: false });
        assert.equal((await call("getNdiStatus")).decks.active.pid, before.decks.active.pid, "Changing leveling must not interrupt the on-air decoder");
        await call("stopNdiFile");
        await call("playNdiFile", media.path, 0, "", { itemId: item.id, inPointSeconds: 0, outPointSeconds: 40, loop: true });
        const bypass = await call("getNdiStatus");
        args = execFileSync("ps", ["-p", String(bypass.decks.active.pid), "-o", "args="], { encoding: "utf8" });
        assert(!args.includes("alimiter="), "The saved bypass must apply to the next decoder");
        console.log("LIBRARY WATCH + LEVELING: actual Chromium playback, pause/seek/volume/ESC, unchanged PROGRAM decoder/queue, imported-only access, measured FFmpeg filter and deferred persisted bypass passed");
    } finally {
        await call("stopNdiFile").catch(() => {});
        if (operation) await call("saveOperationSettings", operation).catch(() => {});
        if (categories) await call("saveLibraryCategories", categories).catch(() => {});
        if (prior) await call("saveTimeline", prior).catch(() => {});
        ws.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
