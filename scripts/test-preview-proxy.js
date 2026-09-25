"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const ffmpeg = require("ffmpeg-static");
const ffprobeModule = require("@derhuerst/ffprobe-static");
const ffprobe = typeof ffprobeModule === "string"
    ? ffprobeModule : (ffprobeModule.path || ffprobeModule.default);
const { preparePreviewProxy } = require("../src/core/media/preview-proxy");
const { buildMediaUrl, serveImportedVideo } =
    require("../src/core/media/media-protocol");

async function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "santtos-proxy-test-"));
    try {
        const source = path.join(root, "filme de teste.mkv");
        execFileSync(ffmpeg, [
            "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30000/1001",
            "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000",
            "-t", "1", "-c:v", "libx264", "-preset", "ultrafast",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-y", source
        ], { windowsHide: true, timeout: 45000 });

        const cache = path.join(root, "cache");
        const previewPath = await preparePreviewProxy(source, cache);
        assert(fs.existsSync(previewPath), "A previa MP4 deve ser criada.");
        assert(fs.statSync(previewPath).size > 1000, "A previa MP4 nao pode ser vazia.");
        assert.equal(path.extname(previewPath), ".mp4");
        const second = await preparePreviewProxy(source, cache);
        assert.equal(second, previewPath, "A mesma midia deve usar o cache.");

        const json = JSON.parse(execFileSync(ffprobe, [
            "-v", "error", "-show_entries", "stream=codec_name,codec_type",
            "-of", "json", previewPath
        ], { windowsHide: true, encoding: "utf8", timeout: 20000 }));
        assert(json.streams.some(x => x.codec_type === "video" && x.codec_name === "h264"));
        assert(json.streams.some(x => x.codec_type === "audio" && x.codec_name === "aac"));

        const request = new Request(buildMediaUrl(previewPath), {
            headers: { Range: "bytes=0-31" }
        });
        assert.equal(serveImportedVideo(request, [{ path: source }]).status, 404);
        const approved = new Set([fs.realpathSync(previewPath)]);
        const result = serveImportedVideo(request, [{ path: source }], approved);
        assert.equal(result.status, 206);
        assert.equal(Buffer.from(await result.arrayBuffer()).length, 32);

        await assert.rejects(
            preparePreviewProxy(path.join(root, "missing.mkv"), cache),
            /ENOENT|indisponivel/
        );
        console.log("PREVIEW PROXY QA: APROVADO — H.264/AAC, cache e acesso controlado.");
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error("PREVIEW PROXY QA: REPROVADO", error);
    process.exitCode = 1;
});
