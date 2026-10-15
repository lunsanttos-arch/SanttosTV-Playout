"use strict";
const { EventEmitter } = require("node:events");
class ProgramServiceClient extends EventEmitter {
    constructor({ fork, config, hostCall, event, maxPending = 256 }) {
        super(); Object.assign(this, { fork, config, hostCall, event, maxPending });
        this.pending = new Map(); this.sequence = 0; this.child = null; this.closing = false; this.failures = [];
    }
    start() {
        if (this.starting) return this.starting;
        this.starting = new Promise((resolve, reject) => {
            const child = this.fork(); this.child = child;
            const timer = setTimeout(() => { reject(Error("Serviço PROGRAM não iniciou em 30 segundos.")); child.kill(); }, 30000);
            child.on("message", async message => {
                if (this.child !== child) return;
                if (message.type === "ready") {
                    clearTimeout(timer); this.pid = message.pid; this.channels = message.channels; this.lastHeartbeat = performance.now(); this.probeAt = null;
                    this.watchdogTimer = setInterval(() => {
                        if (performance.now() - this.lastHeartbeat < 10000 || this.closing) return;
                        if (this.probeAt === null) { this.probeAt = performance.now(); return; }
                        if (performance.now() - this.probeAt > 3000 && !this.terminating) {
                            this.terminating = true; this.emit("fault", "Serviço PROGRAM sem responder; reiniciando com checkpoint."); child.kill();
                            this.killTimer = setTimeout(() => { if (this.child === child) try { process.kill(this.pid, "SIGKILL"); } catch {} }, 1000);
                            this.killTimer.unref();
                        }
                    }, 1000); this.watchdogTimer.unref();
                    resolve(); this.emit("ready");
                }
                if (message.type === "heartbeat") { this.lastHeartbeat = performance.now(); this.probeAt = null; }
                if (message.type === "fatal") { clearTimeout(timer); this.closing = true; reject(Error(message.error)); this.emit("fault", message.error); }
                if (message.type === "reply") {
                    const waiting = this.pending.get(message.id); if (!waiting) return;
                    this.pending.delete(message.id); clearTimeout(waiting.timer);
                    if (message.error) waiting.reject(Error(message.error)); else waiting.resolve(message.value);
                }
                if (message.type === "host-call") {
                    try { child.postMessage({ type: "host-reply", id: message.id, value: await this.hostCall(message.action, message.args) }); }
                    catch (error) { child.postMessage({ type: "host-reply", id: message.id, error: error.message }); }
                }
                if (message.type === "event") {
                    let acknowledge = true;
                    try { acknowledge = this.event(message.channel, message.payload) !== false; }
                    catch (error) { console.error("Monitor indisponível:", error.message); }
                    finally { if (message.acknowledge && acknowledge) child.postMessage({ type: "event-ack", channel: message.channel }); }
                }
                if (message.type === "relaunch") this.emit("relaunch");
                if (message.type === "request-quit") this.emit("request-quit");
            });
            child.once("exit", code => {
                clearTimeout(timer); if (this.child !== child) return;
                clearInterval(this.watchdogTimer); clearTimeout(this.killTimer); this.terminating = false;
                this.child = null; this.starting = null;
                const error = Error(`Serviço PROGRAM interrompido (${code}).`); reject(error);
                for (const waiting of this.pending.values()) { clearTimeout(waiting.timer); waiting.reject(error); } this.pending.clear();
                if (this.closing) return;
                this.emit("fault", error.message);
                this.failures = this.failures.filter(time => Date.now() - time < 60000); this.failures.push(Date.now());
                if (this.failures.length <= 3) this.restartTimer = setTimeout(() => this.start().catch(error => this.emit("fault", error.message)), 1000);
            });
            child.postMessage({ type: "init", config: this.config });
        });
        return this.starting;
    }
    async call(channel, args = [], timeoutMs = 30000) {
        await this.start();
        if (!this.child || this.pending.size >= this.maxPending) throw Error("Serviço PROGRAM ocupado ou indisponível.");
        const id = ++this.sequence;
        return new Promise((resolve, reject) => {
            const timer = timeoutMs ? setTimeout(() => { this.pending.delete(id); reject(Error("Comando PROGRAM excedeu o tempo limite.")); }, timeoutMs) : null;
            this.pending.set(id, { resolve, reject, timer }); this.child.postMessage({ type: "command", id, channel, args });
        });
    }
    notify(channel, args) { this.child?.postMessage({ type: "notify", channel, args }); }
    monitorAck(channel) { this.child?.postMessage({ type: "event-ack", channel }); }
    resetMonitor() { this.child?.postMessage({ type: "event-reset" }); }
    async close() {
        this.closing = true; clearTimeout(this.restartTimer); clearInterval(this.watchdogTimer);
        if (this.child) { try { await this.call("service:shutdown", [], 0); } finally { this.child?.kill(); } }
    }
}
module.exports = { ProgramServiceClient };
