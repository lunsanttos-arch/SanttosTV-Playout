"use strict";
// Install the actual NSIS candidate in a disposable Windows CI directory, then
// run its bundled PROGRAM. Never touch an operator's application/profile.
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const net = require("node:net");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function port() {
    const server = net.createServer();
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const number = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return number;
}
(async () => {
    assert(process.platform === "win32" && process.env.GITHUB_ACTIONS === "true", "Only disposable Windows GitHub runners");
    const root = path.resolve(__dirname, ".."), version = require("../package.json").version;
    const kit = path.join(root, "build", `release-${version}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(kit, "release.json"), "utf8"));
    const installer = path.join(kit, manifest.installer.path);
    assert.equal(createHash("sha256").update(fs.readFileSync(installer)).digest("hex"), manifest.installer.sha256);
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "santtos-installed-"));
    const installed = path.join(folder, "application"), profile = path.join(folder, "profile");
    const logFolder = path.join(root, "build", "installed-smoke");
    fs.mkdirSync(logFolder, { recursive: true });
    let child, ws, serial = 0; const pending = new Map();
    async function evaluate(expression) {
        const id = ++serial; let timer;
        const response = new Promise(resolve => pending.set(id, resolve));
        ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
        try {
            const result = await Promise.race([response, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("Installed IPC timeout")), 15000); })]);
            if (result.error || result.result.exceptionDetails) throw Error(JSON.stringify(result.error || result.result.exceptionDetails));
            return result.result.result.value;
        } finally { clearTimeout(timer); pending.delete(id); }
    }
    const call = (method, ...args) => evaluate(`window.santtosAPI.${method}(...${JSON.stringify(args)})`);
    try {
        // /D must be the final NSIS argument. runAfterFinish is false in the package.
        execFileSync(installer, ["/S", `/D=${installed}`], { windowsHide: true, timeout: 120000, stdio: "inherit" });
        const executable = path.join(installed, "SanttosTVAutomation.exe");
        assert(fs.existsSync(executable), "NSIS did not install the application");
        for (const entry of manifest.components) {
            const file = path.join(installed, entry.path);
            assert(fs.existsSync(file), `Installer omitted ${entry.path}`);
            assert.equal(createHash("sha256").update(fs.readFileSync(file)).digest("hex"), entry.sha256, `Installed component changed: ${entry.path}`);
        }
        const mediaRuntime = path.join(installed, "resources", "runtime");
        const fixture = path.join(folder, "installed-playback.mp4");
        execFileSync(path.join(mediaRuntime, "ffmpeg.exe"), ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25",
            "-f", "lavfi", "-i", "sine=frequency=997:sample_rate=48000", "-t", "3", "-c:v", "libx264", "-threads", "2", "-preset", "ultrafast", "-c:a", "aac", "-y", fixture], { timeout: 30000, windowsHide: true });
        const debugPort = await port();
        const env = { ...process.env, SANTTOS_TEST_MODE: "0", SANTTOS_NDI_TEST_MODE: "0" };
        delete env.FFMPEG_BIN; delete env.FFPROBE_BIN;
        const fd = fs.openSync(path.join(logFolder, "application.log"), "w");
        child = spawn(executable, [`--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, "--remote-debugging-address=127.0.0.1", "--disable-gpu"],
            { cwd: installed, env, stdio: ["ignore", fd, fd], windowsHide: true });
        fs.closeSync(fd);
        child.on("error", error => console.error(error));
        let ready = false;
        for (let n = 0; n < 180; n++) {
            try {
                if (!ws || ws.readyState !== WebSocket.OPEN) {
                    const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`, { signal: AbortSignal.timeout(1000) })).json();
                    const page = pages.find(page => page.type === "page");
                    ws = new WebSocket(page.webSocketDebuggerUrl);
                    await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
                    ws.addEventListener("message", event => { const message = JSON.parse(event.data); pending.get(message.id)?.(message); });
                }
                ready = await evaluate('location.protocol === "file:" && document.readyState === "complete" && Boolean(window.santtosAPI)');
                if (ready) break;
            } catch { /* Chromium and preload are still opening. */ }
            if (child.exitCode !== null) throw Error(`Installed application exited at startup: ${child.exitCode}`);
            await wait(200);
        }
        assert(ready, "Installed frontend/preload did not open");
        assert.equal((await call("getMedia")).length, 0, "Installed profile must be isolated and empty");
        const settings = await call("getSettings");
        const saved = await call("saveOutputSettings", { ...settings.output, resolution: "640x480", fps: "25", ndi: { enabled: false }, omt: { enabled: false }, srt: { enabled: false }, rtmp: { enabled: false } });
        assert.notEqual(saved?.ok, false);
        await call("importMedia", [fixture]);
        let media;
        for (let n = 0; n < 300; n++) {
            media = (await call("getMedia"))[0];
            if (media?.quality?.status === "approved") break;
            if (media?.quality?.status === "rejected") throw Error(media.quality.error);
            await wait(200);
        }
        assert.equal(media?.quality?.status, "approved", "Installed QC must use the bundled runtime");
        const item = { ...media, id: "installed-smoke", sourceMediaId: media.id, inPoint: 0, outPoint: 3, loop: true, freezeEnd: false };
        assert.notEqual((await call("applyNativeRundown", [item])).ok, false);
        assert.notEqual((await call("playNdiFile", media.path, 0, "", { itemId: item.id, inPointSeconds: 0, outPointSeconds: 3, loop: true })).ok, false);
        let status;
        for (let n = 0; n < 100; n++) {
            status = await call("getNdiStatus");
            if (status.playout?.state === "PLAYING" && status.decks?.active?.deliveredFrames > 10) break;
            await wait(100);
        }
        assert.equal(status.playout.state, "PLAYING");
        assert(status.decks.active.deliveredFrames > 10, "Installed PROGRAM did not deliver decoded frames");
        fs.writeFileSync(path.join(logFolder, "result.json"), JSON.stringify({ version, installerSha256: manifest.installer.sha256,
            installedComponents: manifest.components.length, isolatedProfile: true, quality: media.quality.status,
            state: status.playout.state, deliveredFrames: status.decks.active.deliveredFrames }, null, 2));
        await call("stopNdiFile");
        console.log("INSTALLED WINDOWS: actual NSIS installation, component hashes, packaged frontend/IPC, isolated profile, bundled QC and PROGRAM decoded playback passed.");
    } finally {
        if (ws?.readyState === WebSocket.OPEN) await evaluate("window.close()").catch(() => {});
        ws?.close();
        if (child) {
            for (let n = 0; n < 50 && child.exitCode === null; n++) await wait(100);
            if (child.exitCode === null) execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        }
        fs.rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
