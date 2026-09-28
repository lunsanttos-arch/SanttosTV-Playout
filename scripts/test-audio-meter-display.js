"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
    path.join(root, "src/renderer/src/program-audio-display.ts"), "utf8"
);
const js = ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        strict: true
    },
    reportDiagnostics: true
});
assert.equal(js.diagnostics?.length || 0, 0, "Audio route must transpile.");
const m = { exports: {} };
vm.runInNewContext(js.outputText, {
    exports: m.exports, module: m
}, { filename: "program-audio-display.js", timeout: 1500 });
const { resolveAudioMeterRoute, audioMeterSourceLabel } = m.exports;

const routing = [
    [{ nativeOutput: false, isPlaying: true, nativeState: "IDLE" }, "preview"],
    [{ nativeOutput: false, isPlaying: false, nativeState: "IDLE" }, "stopped"],
    [{ nativeOutput: true, isPlaying: true, nativeState: "REBUILD_REQUIRED" }, "preview"],
    [{ nativeOutput: true, isPlaying: true, nativeState: "PIPE_NOT_READY" }, "preview"],
    [{ nativeOutput: true, isPlaying: true, nativeState: "ERROR" }, "preview"],
    [{ nativeOutput: true, isPlaying: true, nativeState: "STARTING" }, "preview"],
    [{ nativeOutput: true, isPlaying: true, nativeState: "FLOWING", nativeActive: false }, "preview"],
    [{ nativeOutput: true, isPlaying: true, nativeState: "FLOWING", nativeActive: true }, "ndi"],
    [{ nativeOutput: true, isPlaying: true, nativeState: "NO_TRACK" }, "no-track"],
    [{ nativeOutput: true, isPlaying: false, nativeState: "FLOWING", nativeActive: true }, "stopped"]
];
for (const [args, expected] of routing) {
    assert.equal(resolveAudioMeterRoute(args), expected,
        "Wrong meter route for " + JSON.stringify(args));
}
assert.match(audioMeterSourceLabel("preview", "REBUILD_REQUIRED"), /PRÉVIA.*NDI ANTIGO/);
assert.match(audioMeterSourceLabel("preview", "PIPE_NOT_READY"), /PRÉVIA.*PIPE OFF/);
assert.match(audioMeterSourceLabel("ndi", "FLOWING"), /NDI PCM/);
assert.equal(audioMeterSourceLabel("no-track", "NO_TRACK"), "SEM FAIXA");
const view = fs.readFileSync(
    path.join(root, "src/renderer/src/ProgramAudioMeters.tsx"), "utf8"
);
assert(view.includes("resolveAudioMeterRoute("),
    "Meters must clearly distinguish NDI PCM, preview and no track.");
assert(!view.includes("if (nativeOutput || !mediaUrl)"),
    "Never block preview metering solely because native NDI mode is selected.");
assert(view.includes('source.connect(ctx.destination)'),
    "Source audio must remain routed to the operator.");
assert(view.includes('onClick={() => void activateMeters()}'),
    "Autoplay-blocked WebAudio must offer an explicit activation action.");
assert(view.includes('NDI não medido'),
    "Local preview fallback must not be presented as confirmed NDI audio.");
assert(view.includes('audio.leftDb') && view.includes('audio.rightDb'),
    "NDI audio source must be read as two independent channels.");
console.log("AUDIO METER QA: APROVADO — prévia sem sender, NDI PCM, sem faixa, pausa e ativação explícita.");
