"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { assessRecovery } = require("../src/core/media/quality-recovery");
const { MediaQualityQueue } = require("../src/core/media/quality-queue");
const { createRecoveryFixture } = require("./h264-recovery-fixture");
const sample = { expected: 61129, frames: 61128, duration: 2549.588708, lastSeconds: 2549.630417, progressEnd: true,
    stderr: "[h264 @ 000002643992a9c0] missing picture in access unit with size 9\n[h264 @ 000002643992a9c0] no frame!\n[h264 @ 0000026439bde040] no frame!\n[vist#0:0/h264 @ 0000026439bde040] Error submitting packet to decoder: Invalid data found when processing input" };
assert(assessRecovery(sample));
for (const patch of [{ frames: 61100 }, { expected: NaN }, { progressEnd: false }, { lastSeconds: 2000 }, { logOverflow: true },
    { stderr: sample.stderr + "\n[h264] concealing 100 DC errors" }, { stderr: sample.stderr.replace("size 9", "size 900") }]) assert.equal(assessRecovery({ ...sample, ...patch }), null);
(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "santtos-h264-recovery-")); let queue;
    try {
        const file = path.join(root, "empty-unit.mp4"); createRecoveryFixture(file);
        const media = [{ id: "recoverable", path: file, name: "Recoverable", duration: 4, videoStreamIndex: 0, audioStreamIndex: 1,
            quality: { version: 1, status: "rejected", fingerprint: `${fs.statSync(file).size}:${fs.statSync(file).mtimeMs}:${fs.statSync(file).ino}` } }];
        queue = new MediaQualityQueue({ ffmpeg: require("../src/core/media/runtime-paths").resolveMediaRuntime("ffmpeg"), getMedia: () => media,
            onUpdate: (id, quality) => { media[0].quality = quality; } });
        // Old-policy rejection must trigger a fresh scan, without allowing queued rejected bytes to play.
        await assert.rejects(() => queue.validate(media), /pendente/);
        await assert.rejects(() => queue.assertPlayable(media[0]), /reprovado/);
        for (let i = 0; i < 600 && (queue.pending.size || queue.running); i++) await new Promise(resolve => setTimeout(resolve, 20));
        const q = media[0].quality;
        assert.equal(q.status, "approved", JSON.stringify(q)); assert.equal(q.policyVersion, 2);
        assert(q.warning); assert.equal(q.recovery.missingFrames, 1); assert.equal(q.recovery.decodedFrames, 99);
        assert.equal(q.loudness.status, "measured"); assert.equal(q.sha256.length, 64);
        assert(!q.blockedFingerprint); await queue.validate(media); await queue.assertPlayable(media[0]);
        console.log("QUALITY RECOVERY: supplied report boundaries, real empty H.264 access unit, old rejection migration, measured audio and warning approval passed.");
    } finally { await queue?.stop(); fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
