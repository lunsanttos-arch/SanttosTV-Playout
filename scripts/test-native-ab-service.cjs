"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os"), http = require("node:http");
const { spawn } = require("node:child_process");
const { resolveMediaRuntime } = require("../src/core/media/runtime-paths");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function connect(port, page) {
    const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const ws = new WebSocket((page ? pages.find(item => item.type === "page") : pages[0]).webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
    let serial = 0; const pending = new Map();
    ws.addEventListener("message", event => { const reply = JSON.parse(event.data); pending.get(reply.id)?.(reply); });
    async function send(method, params = {}) {
        const id = ++serial; let timer;
        const reply = new Promise(resolve => pending.set(id, resolve)); ws.send(JSON.stringify({ id, method, params }));
        try {
            const result = await Promise.race([reply, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("A/B QA inspector timeout")), 15000); })]);
            if (result.error || result.result?.exceptionDetails) throw Error(JSON.stringify(result.error || result.result.exceptionDetails));
            return result;
        } finally { clearTimeout(timer); pending.delete(id); }
    }
    return { ws, send, evaluate: async expression => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.result.value };
}
(async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "santtos-ab-live-"));
    let renderer, host, generator, inputId, prior, frozen = false;
    const server = http.createServer((request, response) => {
        const name = new URL(request.url, "http://127.0.0.1").pathname.slice(1);
        if (!/^(index\.m3u8|segment-\d+\.ts)$/.test(name)) { response.writeHead(404); response.end(); return; }
        const stream = fs.createReadStream(path.join(folder, name));
        stream.on("error", () => { if (!response.headersSent) response.writeHead(404); response.end(); });
        response.on("close", () => stream.destroy()); stream.pipe(response);
    });
    const mainFile = path.resolve(__dirname, "../src/main/main.js");
    const client = `process.getBuiltinModule('node:module').createRequire(${JSON.stringify(mainFile)})(${JSON.stringify(mainFile)}).programService`;
    let call;
    try {
        renderer = await connect(9333, true); host = await connect(19334, false);
        call = (channel, args = []) => host.evaluate(`${client}.call(${JSON.stringify(channel)},${JSON.stringify(args)})`);
        const status = await call("ndi:status"); assert(status.devNullSink && !status.testBench);
        assert.notEqual(status.service.pid, await host.evaluate("process.pid"), "PROGRAM must live in another OS process");
        prior = await call("timeline:list"); await call("ndi:stop-file");
        const media = (await call("media:list"))[0]; assert(media?.duration >= 20);
        generator = spawn(resolveMediaRuntime("ffmpeg"), ["-hide_banner", "-loglevel", "error", "-re", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25",
            "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000", "-c:v", "libx264", "-threads", "2", "-preset", "ultrafast", "-g", "25",
            "-c:a", "aac", "-f", "hls", "-hls_time", "1", "-hls_list_size", "6", "-hls_flags", "delete_segments+temp_file",
            "-hls_segment_filename", path.join(folder, "segment-%05d.ts"), path.join(folder, "index.m3u8")], { stdio: ["ignore", "ignore", "pipe"] });
        let stderr = ""; generator.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-1000); });
        for (let n = 0; n < 100 && !fs.existsSync(path.join(folder, "segment-00001.ts")); n++) await wait(100);
        assert(fs.existsSync(path.join(folder, "index.m3u8")), stderr);
        await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
        const url = `http://127.0.0.1:${server.address().port}/index.m3u8`;
        const input = await call("web-inputs:save", [{ name: "A/B QA live", url, protocol: "hls", engine: "ffmpeg", durationSeconds: 3 }]);
        inputId = input.input.id;
        const items = [
            { ...media, id: "ab-local", sourceMediaId: media.id, inPoint: 0, outPoint: 10 },
            { id: "ab-live", sourceMediaId: inputId, inputId, name: "Live HLS", path: url, sourceType: "input", inputProtocol: "hls", inputEngine: "ffmpeg", inPoint: 0, outPoint: 3, duration: 3 },
            { ...media, id: "ab-after-live", sourceMediaId: media.id, inPoint: 12, outPoint: 15 }
        ].map(item => ({ ...item, loop: false, freezeEnd: false }));
        assert((await call("playout:apply-rundown", [items])).ok);
        const started = await call("ndi:play-file", [media.path, 0, "", { itemId: items[0].id, inPointSeconds: 0, outPointSeconds: 10 }]);
        assert.equal(started.playout?.state, "PLAYING", JSON.stringify(started));
        await renderer.evaluate(`window.__monitorQA = {frames:0}; window.__monitorQA.off = window.santtosAPI.onProgramPreviewFrame(() => window.__monitorQA.frames++);`);
        const images = [];
        for (let n=0;n<8;n++) {
            await wait(150);
            images.push(await renderer.evaluate(`document.querySelector('.program-native-preview-canvas')?.toDataURL()`));
        }
        const previews = await renderer.evaluate(`window.__monitorQA.off(); window.__monitorQA.frames`);
        assert(previews >= 5, `Preview stalled while audio/PROGRAM continues: ${previews} frames in 1.2 s; ${JSON.stringify((await call("ndi:status")).decks)}`);
        assert(new Set(images.filter(Boolean)).size >= 3, "PROGRAM canvas must show actual changing video, not a repeated frozen image");
        await renderer.send("Page.setWebLifecycleState", { state: "frozen" }); frozen = true;
        let prepared;
        for (let n = 0; n < 100; n++) {
            const state = await call("ndi:status");
            if (state.decks.prepared.itemId === "ab-live" && state.decks.prepared.ready) { prepared = state; break; }
            assert.equal(state.playout.itemId, "ab-local", "Live must be ready before the scheduled CUT"); await wait(100);
        }
        assert(prepared, "Backend must prepare live HLS while renderer JavaScript is frozen");
        assert(prepared.decks.prepared.bufferedFrames > 0 && prepared.decks.prepared.bufferedAudioBytes > 0);
        assert.notEqual(prepared.decks.active.pid, prepared.decks.prepared.pid);
        // Block the Electron main thread. PROGRAM's frame delivery must keep running.
        await host.evaluate("(() => { const end = Date.now() + 800; while (Date.now() < end) {} return true; })()");
        const diagnostics = await call("operation:get");
        assert(diagnostics.diagnostics.metrics.maxFrameGapMs < 250, "Electron main thread blocked PROGRAM cadence");
        let live, next;
        for (let n = 0; n < 160; n++) {
            const state = await call("ndi:status");
            if (state.playout.itemId === "ab-live" && state.playout.state === "PLAYING") live ??= state;
            if (state.playout.itemId === "ab-after-live" && state.playout.state === "PLAYING") { next = state; break; }
            await wait(100);
        }
        assert(live && next, "Frozen UI must not prevent live OUT or the following local file");
        assert.equal(live.decks.active.pid, prepared.decks.prepared.pid, "CUT must reuse the prepared decoder, not spawn another");
        assert(live.decks.lastCut.prepared && live.decks.lastCut.gapMs < 250);
        assert(next.decks.lastCut.prepared && next.decks.lastCut.gapMs < 250);
        console.log(`NATIVE A/B SERVICE: distinct PROGRAM PID, frozen-renderer autonomous live preparation, ready video+PCM, prepared PID reused at CUT, HLS OUT/local successor, Electron main blocked 800 ms with max PROGRAM gap ${diagnostics.diagnostics.metrics.maxFrameGapMs.toFixed(1)} ms passed`);
    } finally {
        if (frozen) {
            await renderer.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});
            await host.evaluate(`process.getBuiltinModule('node:module').createRequire(${JSON.stringify(mainFile)})('electron').BrowserWindow.getAllWindows().forEach(w => { w.hide(); w.show(); w.focus(); })`).catch(() => {});
            await renderer.send("Page.bringToFront").catch(() => {}); await wait(200);
        }
        if (call) { await call("ndi:stop-file").catch(() => {}); if (prior) await call("timeline:save", [prior]).catch(() => {}); if (inputId) await call("web-inputs:remove", [inputId]).catch(() => {}); }
        renderer?.ws.close(); host?.ws.close();
        generator?.kill(); server.close(); server.closeAllConnections();
        if (generator && generator.exitCode === null) await new Promise(resolve => generator.once("exit", resolve));
        fs.rmSync(folder, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
