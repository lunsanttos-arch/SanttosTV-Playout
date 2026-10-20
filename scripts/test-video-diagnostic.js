"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { diagnose } = require("./diagnose-video");
const ffmpeg = require("../src/core/media/runtime-paths").resolveMediaRuntime("ffmpeg");
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "santtos-diagnostic-"));
    try {
        const good = path.join(root, "good.mp4"), bad = path.join(root, "bad.mp4"), output = path.join(root, "reports");
        execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25",
            "-f", "lavfi", "-i", "sine=sample_rate=48000", "-t", "4", "-c:v", "libx264", "-threads", "1", "-preset", "ultrafast",
            "-g", "25", "-c:a", "aac", "-movflags", "+faststart", "-y", good]);
        const bytes = fs.readFileSync(good), offset = Math.floor(bytes.length * .65); bytes.fill(0, offset, offset + 4096); fs.writeFileSync(bad, bytes);
        const hashes = [hash(good), hash(bad)];
        const valid = await diagnose(good, output), invalid = await diagnose(bad, output);
        assert.equal(valid.report.strict.exitCode, 0); assert.equal(valid.report.strict.frames, 100);
        assert.equal(valid.report.tolerant.exitCode, 0); assert.equal(valid.report.tolerant.progressEnd, true);
        assert(valid.report.tolerant.lastMediaSeconds >= 3.9);
        assert.notEqual(invalid.report.strict.exitCode, 0);
        assert(invalid.report.tolerant.frames > invalid.report.strict.frames);
        assert(invalid.report.strict.messages.length > 0);
        assert(!fs.readFileSync(invalid.destination, "utf8").includes(root), "Report must omit local paths");
        assert.deepEqual([hash(good), hash(bad)], hashes, "Diagnostic must not alter originals");
        assert(valid.report.file.unchangedDuringTest && invalid.report.file.unchangedDuringTest);
        console.log("VIDEO DIAGNOSTIC: strict/default decoding, error capture, progress time, redaction and unchanged originals verified.");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
