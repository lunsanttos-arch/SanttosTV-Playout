"use strict";
const assert = require("node:assert/strict"), http = require("node:http"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { resolveMediaRuntime } = require("../src/core/media/runtime-paths");
const { remoteInputArgs } = require("../src/core/playout/remote-input");
(async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "santtos-loopback-")), fixture = path.join(folder, "clip.ts");
    const ffmpeg = resolveMediaRuntime("ffmpeg");
    let proxyRequests = 0;
    const origin = http.createServer((_request, response) => { response.writeHead(200, {"Content-Type":"video/mp2t"}); fs.createReadStream(fixture).pipe(response); });
    const proxy = http.createServer((_request, response) => { proxyRequests++; response.writeHead(403); response.end("Forbidden by external proxy"); });
    try {
        execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=size=64x64:rate=25", "-t", "0.4", "-c:v", "mpeg2video", "-threads", "1", "-f", "mpegts", fixture]);
        await Promise.all([new Promise(resolve => origin.listen(0, "127.0.0.1", resolve)), new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve))]);
        const url = `http://127.0.0.1:${origin.address().port}/index.ts`;
        async function decode(args) {
            return new Promise((resolve, reject) => {
                const child = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", ...args, "-i", url, "-frames:v", "1", "-f", "null", "-"], {
                    env: {...process.env, http_proxy:`http://127.0.0.1:${proxy.address().port}`, no_proxy:"", NO_PROXY:""}, stdio:["ignore","ignore","pipe"] });
                let error = ""; child.stderr.on("data", chunk => { error += chunk; });
                const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(Error("Loopback decoder timed out")); }, 5000);
                child.on("error", reject); child.on("close", code => { clearTimeout(timeout); resolve({code,error}); });
            });
        }
        const unprotected = await decode([]);
        assert.notEqual(unprotected.code, 0); assert.match(unprotected.error, /403/); assert.equal(proxyRequests, 1);
        const protectedInput = await decode(remoteInputArgs(url));
        assert.equal(protectedInput.code, 0, protectedInput.error);
        assert.equal(proxyRequests, 1, "Loopback media must not be sent to an inherited external proxy");
        assert(!remoteInputArgs("https://example.com/live.m3u8").includes("-http_proxy"), "Public sources retain their configured proxy route");
        console.log("LOOPBACK INPUT: reproduced proxy 403, local FFmpeg playback succeeds without forwarding loopback traffic; public proxy settings preserved");
    } finally { origin.close(); origin.closeAllConnections(); proxy.close(); proxy.closeAllConnections(); fs.rmSync(folder,{recursive:true,force:true}); }
})().catch(error => { console.error(error); process.exitCode=1; });
