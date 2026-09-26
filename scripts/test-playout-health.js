"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PlayoutHealth } = require("../src/core/monitoring/playout-health");
const { IncidentJournal } = require("../src/core/monitoring/incident-journal");

let now = new Date("2026-09-25T18:00:00Z").getTime();
const emitted = [];
const health = new PlayoutHealth({
    now: () => now,
    frameBytes: 8,
    stallMs: 8000,
    startupMs: 15000,
    onIncident: entry => emitted.push(entry)
});

assert.equal(health.snapshot().state, "IDLE");
health.start("C:\\TV\\videos\\filme.mp4");
assert.equal(health.snapshot().state, "STARTING");
assert.equal(health.snapshot().mediaName, "filme.mp4");
health.acceptBytes(4);
assert.equal(health.snapshot().decodedFramesApprox, 0,
    "No complete frame must be reported for partial data.");
now += 15001;
assert.equal(health.snapshot().state, "START_DELAY");
assert.equal(emitted.filter(x => x.type === "DEMORA_INICIAL").length, 1);
health.snapshot();
assert.equal(emitted.filter(x => x.type === "DEMORA_INICIAL").length, 1,
    "Repeated status polls must not duplicate alerts.");
health.acceptBytes(4);
assert.equal(health.snapshot().state, "FLOWING");
assert.equal(emitted.filter(x => x.type === "FLUXO_RESTABELECIDO").length, 1);
health.acceptBytes(8);
assert.equal(health.snapshot().decodedFramesApprox, 2);
now += 8001;
assert.equal(health.snapshot().state, "STALLED");
assert.equal(health.snapshot().lastByteAgoMs, 8001);
health.snapshot();
assert.equal(emitted.filter(x => x.type === "QUADROS_PARADOS").length, 1,
    "A single decoder stall must create only one incident.");
health.acceptBytes(8);
assert.equal(health.snapshot().state, "FLOWING");
assert.equal(emitted.filter(x => x.type === "FLUXO_RESTABELECIDO").length, 2);

health.stop();
now += 100000;
assert.equal(health.snapshot().state, "IDLE");
assert.equal(emitted.filter(x => x.type === "QUADROS_PARADOS").length, 1,
    "A stopped decoder must not raise new freeze alerts.");

health.start("/mnt/media/break.mov");
health.acceptBytes(8);
assert.equal(health.snapshot(false).state, "NDI_OFFLINE");
health.snapshot(false);
assert.equal(emitted.filter(x => x.type === "NDI_OFFLINE").length, 1);
assert.equal(health.snapshot(true).state, "FLOWING");
assert.equal(emitted.filter(x => x.type === "FLUXO_RESTABELECIDO").length, 3);

health.fail("Falha inesperada no FFmpeg");
health.fail("Falha inesperada no FFmpeg");
assert.equal(health.snapshot().state, "FAULT");
assert.equal(emitted.filter(x => x.type === "FALHA_PLAYOUT").length, 1);
health.start("/mnt/new-video.mp4");
assert.equal(health.snapshot().state, "STARTING");
health.senderLost("sender saiu");
assert.equal(health.snapshot().state, "FAULT");
assert.equal(emitted.filter(x => x.type === "NDI_OFFLINE").length, 2);
health.senderReady();
assert.equal(emitted.filter(x => x.type === "NDI_RESTABELECIDO").length, 1);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "santtos-health-"));
try {
    const journal = new IncidentJournal(root, { maxBytes: 250 });
    for (let i = 0; i < 14; i++) {
        journal.append({
            at: new Date(now + i * 1000).toISOString(),
            type: "QUADROS_PARADOS",
            detail: "teste " + i,
            mediaName: "filme.mp4"
        });
    }
    assert(fs.existsSync(journal.previousPath), "Log must rotate at its size limit.");
    assert(fs.statSync(journal.filePath).size <= 250,
        "Current journal segment must stay bounded.");
    assert.equal(journal.recent(1)[0].detail, "teste 13");
    const restored = new IncidentJournal(root, { maxBytes: 250 });
    assert.equal(restored.recent(1)[0].detail, "teste 13",
        "Incidents must survive application restart.");
    fs.appendFileSync(journal.filePath, "{interrupted power cut");
    const recovered = new IncidentJournal(root, { maxBytes: 250 });
    assert.equal(recovered.recent(1)[0].detail, "teste 13",
        "Truncated last record must not erase valid incidents.");
    recovered.append({
        at: new Date(now + 15000).toISOString(),
        type: "FLUXO_RESTABELECIDO",
        detail: "restored after power loss",
        mediaName: "filme.mp4"
    });
    const reloadedAfterTornWrite = new IncidentJournal(root, { maxBytes: 250 });
    assert.equal(reloadedAfterTornWrite.recent(1)[0].detail,
        "restored after power loss",
        "A torn last line must not swallow the first new incident.");
    assert.throws(() => new IncidentJournal("relative/folder"), /invalida/);
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}

const main = fs.readFileSync(
    path.join(__dirname, "../src/main/main.js"), "utf8"
);
assert(main.includes('processRef.stdout.on("data"') &&
    main.includes("playoutHealth.acceptBytes(chunk.length)"),
    "Monitor must use real FFmpeg stdout output, not React play state.");
assert(main.includes('"monitor:export"') &&
    main.includes("dialog.showSaveDialog"),
    "Operator must explicitly choose where to save diagnostics.");
assert(main.includes("playoutHealth.senderLost(reason)"),
    "Unexpected native NDI exits must generate a persistent incident.");
assert(main.includes("function startHealthWatch()") &&
    main.includes("healthWatchTimer = setInterval(") &&
    main.includes("startHealthWatch();"),
    "FFmpeg freezing must be detected by the Electron main process even when the UI is minimized.");

assert(!main.includes("playoutHealth.restartPlayback"),
    "The watchdog must never auto-restart a playing clip.");
assert(main.includes("if (code === 0 && !signal)") &&
    main.includes("playoutHealth.stop();"),
    "A normally completed FFmpeg clip must not be reported as a decoder crash.");


console.log("HEALTH QA: APROVADO — startup, stall, dedup, recovery, NDI fault, journal rotation and power-cut recovery.");
