"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const typescript = require("typescript");

const source = fs.readFileSync(
    path.join(__dirname, "../src/renderer/src/timeline-forecast.ts"), "utf8"
);
const compiled = typescript.transpileModule(source, {
    compilerOptions: {
        module: typescript.ModuleKind.CommonJS,
        target: typescript.ScriptTarget.ES2022,
        strict: true
    },
    reportDiagnostics: true
});
assert(!compiled.diagnostics?.length, "Pure forecast module should transpile.");
const cjs = { exports: {} };
vm.runInNewContext(compiled.outputText, {
    module: cjs, exports: cjs.exports, Date, Math, Map, Number
}, { filename: "timeline-forecast.js", timeout: 1000 });
const {
    buildTimelineForecast, knownClipRange, formatEstimatedClock,
    formatRemaining, describeForecastEntry
} = cjs.exports;

const now = new Date(2026, 8, 25, 23, 59, 50).getTime();
const queue = [
    { id: "movie-block-1", duration: 130, inPoint: 30, outPoint: 130, loop: false },
    { id: "ad", duration: 30, loop: false },
    { id: "movie-block-2", duration: 120, inPoint: 15, outPoint: 75, loop: false }
];

function plan(items = queue, selected = queue[0].id, params = {}) {
    return buildTimelineForecast(items, selected, {
        nowMs: now, isRunning: true, currentTime: 40, ...params
    });
}

assert.equal(knownClipRange(queue[0]).length, 100);
assert.equal(knownClipRange(queue[2]).length, 60);
assert.equal(knownClipRange({ id: "unanalysed", duration: null }), null);
assert.equal(knownClipRange({ id: "explicit-end", duration: null, outPoint: 20 }).length, 20);
assert.equal(formatRemaining(0.01), "00:00:01");
assert.equal(formatRemaining(3601), "01:00:01");

const running = plan();
assert.equal(running.entries.get(queue[0].id).state, "current");
assert.equal(running.entries.get(queue[1].id).state, "upcoming");
assert.equal(running.entries.get(queue[1].id).remainingSeconds, 90);
assert.equal(running.entries.get(queue[1].id).startsAtMs, now + 90000);
assert.equal(running.entries.get(queue[2].id).startsAtMs, now + 120000);
assert.equal(running.endsAtMs, now + 180000);
assert.equal(running.remainingSeconds, 180);
assert(formatEstimatedClock(now + 90000, now).includes("(+1 dia)"),
    "Virada da meia-noite deve avisar que a entrada ocorre amanhã.");
assert(describeForecastEntry(running.entries.get(queue[1].id), now).includes("ENTRA EST."));
assert(describeForecastEntry(running.entries.get(queue[0].id), now, true).includes("FIM EST."));

const tenSecondsLater = plan(queue, queue[0].id, {
    nowMs: now + 10000, currentTime: 50
});
assert.equal(tenSecondsLater.entries.get("ad").startsAtMs, now + 90000,
    "O horario de entrada deve ficar ESTAVEL enquanto o video avanca normalmente.");
assert.equal(tenSecondsLater.entries.get("ad").remainingSeconds, 80);

const paused = plan(queue, queue[0].id, {
    nowMs: now + 10000, isRunning: false, currentTime: 50
});
assert.equal(paused.entries.get("ad").startsAtMs, null,
    "PAUSA: nunca inventar um horario de entrada.");
assert.equal(paused.entries.get("movie-block-1").state, "paused");
assert.match(describeForecastEntry(paused.entries.get("ad"), now + 10000), /AGUARDANDO PLAY/);
assert.equal(paused.endsAtMs, null);
assert.equal(paused.isLive, false);

const resumedMuchLater = plan(queue, queue[0].id, {
    nowMs: now + 600000, currentTime: 50
});
assert.equal(resumedMuchLater.entries.get("ad").startsAtMs, now + 680000,
    "Retomada: calcular a partir do novo horario real, não do inicio antigo.");

const seekForward = plan(queue, queue[0].id, { currentTime: 110 });
assert.equal(seekForward.entries.get("ad").remainingSeconds, 20);
const reordered = plan([queue[0], queue[2], queue[1]], queue[0].id, {
    currentTime: 110
});
assert.equal(reordered.entries.get("movie-block-2").remainingSeconds, 20);
assert.equal(reordered.entries.get("ad").remainingSeconds, 80);
assert.equal(reordered.entries.get("ad").startsAtMs, now + 80000);

const startedSecond = plan(queue, "ad", { currentTime: 10 });
assert.equal(startedSecond.entries.has("movie-block-1"), false);
assert.equal(startedSecond.entries.get("movie-block-2").remainingSeconds, 20);

const looping = plan([{ ...queue[0], loop: true }, queue[1]], queue[0].id);
assert.equal(looping.entries.get("movie-block-1").state, "loop");
assert.equal(looping.entries.get("ad").state, "blocked-loop");
assert.equal(looping.entries.get("ad").startsAtMs, null);
assert.equal(looping.endsAtMs, null);
const futureLoop = plan([queue[0], { ...queue[1], loop: true }, queue[2]]);
assert.equal(futureLoop.entries.get("ad").startsAtMs, now + 90000);
assert.equal(futureLoop.entries.get("movie-block-2").state, "blocked-loop");
const previouslyLooped = plan([
    { id: "completed-loop", duration: 20, loop: true },
    queue[1], queue[2]
], "ad", { currentTime: 10 });
assert.equal(previouslyLooped.hasLoop, false,
    "Um loop antes do vídeo atual não pode bloquear horários futuros.");
assert.equal(previouslyLooped.entries.get("movie-block-2").remainingSeconds, 20);
assert.notEqual(previouslyLooped.endsAtMs, null);


const unknown = plan([queue[0], { id: "missing", duration: null }, queue[2]]);
assert.equal(unknown.entries.get("missing").state, "unknown-duration");
assert.equal(unknown.entries.get("movie-block-2").state, "blocked-duration");
assert.equal(unknown.endsAtMs, null);
assert(!describeForecastEntry(unknown.entries.get("movie-block-2"), now).includes("ENTRA EST."));

const notStarted = plan(queue, null);
assert.equal(notStarted.isLive, false);
assert.equal(notStarted.entries.get("movie-block-1").startsAtMs, null);
const staleSelection = plan(queue, "deleted-video");
assert.equal(staleSelection.isLive, false);
assert.equal(staleSelection.endsAtMs, null);

const midnight = formatEstimatedClock(now + 90000, now);
assert(midnight.includes("(+1 dia)"));
assert.equal(formatEstimatedClock(now, now).includes("(+1 dia)"), false);
const long = plan([{ id: "feature", duration: 100000 }, { id: "next", duration: 60 }],
    "feature", { currentTime: 0 });
assert.equal(long.entries.get("next").remainingSeconds, 100000);
assert(long.entries.get("next").startsAtMs > now + 86400000);
console.log(
    "TIMELINE ETA QA: APROVADO — cortes, countdown estável, pausa/retomada, seek, reordenação, loop, mídia sem duração e meia-noite."
);
