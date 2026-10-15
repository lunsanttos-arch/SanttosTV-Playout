"use strict";
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { ProgramServiceClient } = require("../src/main/program-service-client");
(async () => {
    const sent = []; let child;
    const client = new ProgramServiceClient({ maxPending: 1, config: {}, hostCall: async () => "host", event: () => false,
        fork() {
            child = new EventEmitter(); child.kill = () => child.emit("exit", 0);
            child.postMessage = message => { sent.push(message); if (message.type === "init") queueMicrotask(() => child.emit("message", { type: "ready", pid: 456, channels: ["play"] }));
                if (message.channel === "service:shutdown") queueMicrotask(() => child.emit("message", { type: "reply", id: message.id, value: { ok: true } })); };
            return child;
        } });
    await client.start(); assert.equal(client.pid, 456);
    const playing = client.call("play"); await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(client.call("next"), /ocupado/);
    const command = sent.find(message => message.type === "command");
    child.emit("message", { type: "reply", id: command.id, value: { ok: true } }); assert((await playing).ok);
    child.emit("message", { type: "event", channel: "playout:preview-frame", payload: {}, acknowledge: true });
    assert(!sent.some(message => message.type === "event-ack"), "A frozen renderer must retain its preview credit");
    client.monitorAck("playout:preview-frame"); assert(sent.some(message => message.type === "event-ack"));
    client.resetMonitor(); assert(sent.some(message => message.type === "event-reset"));
    await client.close(); assert(client.closing);
    console.log("PROGRAM SERVICE: bounded command backlog, matching replies, renderer ACK backpressure, monitor reset and graceful close passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
