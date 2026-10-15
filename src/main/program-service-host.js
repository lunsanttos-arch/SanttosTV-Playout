"use strict";
const adapter = require("./program-host-adapter");
let runtime, lastSequence = 0, closing = false;
setInterval(() => adapter.send({ type: "heartbeat" }), 1000).unref();
process.parentPort.on("message", async ({ data: message }) => {
    if (message.type === "init") {
        try {
            adapter.initialize(message.config); runtime = require("./program-runtime");
            await runtime.boot(); adapter.send({ type: "ready", pid: process.pid, channels: [...adapter.handlers.keys()] });
        } catch (error) { adapter.send({ type: "fatal", error: error.message }); process.exitCode = 1; setTimeout(() => process.exit(1), 100); }
        return;
    }
    if (message.type !== "command") { adapter.receive(message); return; }
    try {
        if (!runtime || closing || !Number.isSafeInteger(message.id) || message.id <= lastSequence) throw Error("Comando fora de ordem ou serviço encerrando.");
        lastSequence = message.id;
        if (message.channel === "service:shutdown") {
            closing = true; await runtime.shutdown(); adapter.send({ type: "reply", id: message.id, value: { ok: true } });
            setTimeout(() => process.exit(0), 100); return;
        }
        const value = await adapter.invoke(message.channel, message.args);
        adapter.send({ type: "reply", id: message.id, value });
    } catch (error) { adapter.send({ type: "reply", id: message.id, error: error.message }); }
});
