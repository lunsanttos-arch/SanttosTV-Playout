"use strict";
// Research only: isolated reproductions. Does not open the app or modify user data.
// Findings may disappear when the production code is fixed; this is not a CI gate.
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "../..");
const { resolveMediaRuntime } = require(path.join(root, "src/core/media/runtime-paths"));
(async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "santtos-broadcast-study-"));
    try {
        const source = fs.readFileSync(path.join(root, "src/renderer/src/App.tsx"), "utf8");
        const marker = "onApply={async (items, startTime, context) => {";
        const start = source.indexOf(marker);
        if (start < 0) throw Error("Application callback changed; review this historical probe before using it.");
        const begin = start + "onApply={".length;
        const end = source.indexOf("\n                            }}", begin);
        if (end < 0) throw Error("Application callback boundaries changed; review the probe.");
        const callback = source.slice(begin, end) + "\n}";
        const rejected = { ok: false, error: "Não foi possível confirmar a gravação: ENOSPC (simulado)" };
        const fakeWindow = { santtosAPI: { applyNativeRundown: async () => rejected } };
        const apply = new Function("window", "testBench", "ndiTestMode", "setRundownApplyRequest", "return (" + callback + ");")(
            fakeWindow, false, false, () => { throw Error("Unexpected state mutation in research probe."); });
        let application;
        try {
            const message = await apply([], "00:00", { date: "2026-10-16" });
            application = { simulatedBackend: rejected, observedMessage: message, incorrectSuccessReproduced: message === "Programação aplicada ao Playout." };
        } catch (error) { application = { simulatedBackend: rejected, observedRejection: error.message, incorrectSuccessReproduced: false }; }

        const ffmpeg = resolveMediaRuntime("ffmpeg");
        const original = path.join(folder, "original.mp4"), damaged = path.join(folder, "damaged.mp4");
        execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25", "-t", "6", "-c:v", "libx264", "-threads", "1", "-preset", "ultrafast", "-g", "25", "-movflags", "+faststart", "-y", original], { windowsHide: true });
        const bytes = fs.readFileSync(original), offset = Math.floor(bytes.length * .65);
        bytes.fill(0, offset, Math.min(bytes.length, offset + 4096)); fs.writeFileSync(damaged, bytes);
        const current = await require(path.join(root, "src/core/media/decode-check")).checkMediaDecode(damaged, 0);
        const full = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-xerror", "-err_detect", "explode", "-i", damaged, "-map", "0:v:0", "-f", "null", "-"], { encoding: "utf8", timeout: 15000, windowsHide: true });
        if (full.error || full.status === null) throw full.error || Error("Full-decode probe did not finish.");
        const result = {
            studyDate: "2026-10-16", platform: process.platform, node: process.version,
            ffmpeg: execFileSync(ffmpeg, ["-version"], { encoding: "utf8", windowsHide: true }).split(/\r?\n/)[0],
            application, media: { fixtureSeconds: 6, corruptedBytes: 4096, corruptionAtFileFraction: .65,
                currentCheckAccepted: current.decodable, fullDecodeExit: full.status,
                incompleteQualityCheckReproduced: current.decodable && full.status !== 0 },
            scope: "Actual application callback with a mocked failed backend; actual decode check on generated temporary media. No physical Windows receiver, no user data or product behavior changed."
        };
        console.log(JSON.stringify(result, null, 2));
    } finally { fs.rmSync(folder, { recursive: true, force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
