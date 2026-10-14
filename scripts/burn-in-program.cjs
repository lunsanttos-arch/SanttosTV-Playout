"use strict";
// Observes the real Electron PROGRAM for wall-clock hours. Does not operate the
// playlist or certify external receivers. Run the fault/operator matrix alongside.
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { redactDiagnostic } = require("../src/core/playout/diagnostic-redaction");
const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };
const hours = Number(option("--hours", "24"));
const seconds = args.includes("--smoke-seconds") ? Number(option("--smoke-seconds", "10")) : hours * 3600;
const port = Number(option("--port", "9333"));
const folder = path.resolve(option("--output", path.join("build", "burn-in-" + Date.now())));
if (!(seconds > 0) || !Number.isFinite(seconds) || !Number.isInteger(port) || port < 1 || port > 65535 || (!args.includes("--smoke-seconds") && ![24, 72].includes(hours))) throw Error("Use --hours 24|72, --port 9333 e --output pasta. --smoke-seconds é apenas teste do coletor.");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket, serial = 0;
const pending = new Map();
async function connect() {
    const response = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(5000) });
    const page = (await response.json()).find(item => item.type === "page");
    if (!page) throw Error("Página Electron não encontrada.");
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
    socket.addEventListener("message", event => { const message = JSON.parse(event.data); if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); } });
}
async function evaluate(expression) {
    const id = ++serial;
    const reply = new Promise(resolve => pending.set(id, resolve));
    socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
    let timer;
    try {
        const message = await Promise.race([reply, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("Interface sem resposta por 5 segundos.")), 5000); })]);
        if (message.error || message.result?.exceptionDetails) throw Error("Falha ao consultar PROGRAM.");
        return message.result.result.value;
    } finally { clearTimeout(timer); pending.delete(id); }
}
(async () => {
    fs.mkdirSync(folder, { recursive: true });
    const stream = fs.createWriteStream(path.join(folder, "samples.jsonl"), { flags: "wx", mode: 0o600 });
    const failures = [], started = performance.now();
    let samples = 0, playingSamples = 0, interrupted = false;
    process.once("SIGINT", () => { interrupted = true; });
    try {
        while (!interrupted && performance.now() - started < seconds * 1000) {
            try {
                if (!socket || socket.readyState !== WebSocket.OPEN) await connect();
                const data = await evaluate("window.santtosAPI.getOperationSettings()");
                if (!data.ok || !data.diagnostics?.engine) throw Error("Diagnóstico não disponível.");
                const diagnostic = data.diagnostics;
                if (diagnostic.engine.state === "PLAYING") playingSamples++;
                if (diagnostic.engine.state === "FAULT") failures.push({ at: new Date().toISOString(), reason: "PROGRAM em FAULT" });
                if (diagnostic.engine.state === "PLAYING" && diagnostic.frameAgeMs > 1000 * data.settings.stallSeconds) failures.push({ at: new Date().toISOString(), reason: "PROGRAM sem novos quadros" });
                stream.write(JSON.stringify(redactDiagnostic({ at: new Date().toISOString(), elapsedSeconds: (performance.now() - started) / 1000, ...diagnostic })) + "\n");
                samples++;
            } catch (error) {
                failures.push({ at: new Date().toISOString(), reason: error.message });
                socket?.close(); socket = null;
            }
            await delay(1000);
        }
    } finally { socket?.close(); await new Promise(resolve => stream.end(resolve)); }
    const elapsedSeconds = (performance.now() - started) / 1000;
    const summary = { mode: args.includes("--smoke-seconds") ? "COLETOR_SMOKE" : "BURN_IN_REAL", requestedHours: hours, elapsedSeconds,
        completed: !interrupted && elapsedSeconds >= seconds, samples, playingSamples, failures, receiverVerified: false,
        conclusion: "Dados do motor; preencher matriz Windows e medidas A/V do receptor antes de homologar." };
    fs.writeFileSync(path.join(folder, "summary.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ ...summary, failures: failures.length }));
    if (!summary.completed || failures.length || !playingSamples) process.exitCode = 1;
})().catch(error => { console.error(error.message); socket?.close(); process.exitCode = 1; });
