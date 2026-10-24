"use strict";
const handlers = new Map(), listeners = new Map(), pending = new Map();
let config, sequence = 0;
const port = process.parentPort;
function send(message) { port.postMessage(message); }
function hostCall(action, args = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(Error("Host não respondeu: " + action)); }, 120000);
        pending.set(id, { resolve, reject, timer }); send({ type: "host-call", id, action, args });
    });
}
const credits = new Map();
const audioFlights = [];
let audioFlightSeconds = 0, audioFlightBytes = 0;
function hostEvents(channel, payload) {
    const audio = channel === "playout:audio-pcm";
    if (audio) {
        const bytes = payload?.data?.byteLength || 0;
        const rate = Number(payload?.sampleRate), channels = Number(payload?.channels);
        if (!bytes || ![44100,48000,96000].includes(rate) || ![1,2].includes(channels)) return;
        const seconds = bytes / (rate * channels * 4);
        // Four events represented only 67 ms at 60 fps. A bounded media-time
        // window absorbs normal IPC round trips without dropping PCM packets.
        if (audioFlights.length >= 64 || audioFlightSeconds + seconds > .25 + 1e-6 || audioFlightBytes + bytes > 256 * 1024) return;
        audioFlights.push({ seconds, bytes }); audioFlightSeconds += seconds; audioFlightBytes += bytes;
    }
    const limit = channel === "playout:preview-frame" ? 1 : audio ? 64 : null;
    if (limit !== null) {
        if ((credits.get(channel) || 0) >= limit) return;
        credits.set(channel, (credits.get(channel) || 0) + 1);
    }
    send({ type: "event", channel, payload, acknowledge: limit !== null });
}
function initialize(value) {
    config = value;
    if (!process.resourcesPath) process.resourcesPath = config.resourcesPath;
    module.exports.app = {
        isPackaged: config.isPackaged, getPath: name => config.paths[name], getVersion: () => config.version,
        setPath: (name, value) => { config.paths[name] = value; },
        setLoginItemSettings: options => hostCall("loginSettings", options),
        relaunch: () => send({ type: "relaunch" }), quit: () => send({ type: "request-quit" })
    };
}
async function invoke(channel, args) {
    if (channel === "service:media") return require("../database/database").getMedia();
    if (channel === "service:inputs") return require("../core/library/web-inputs").getWebInputs();
    if (channel === "service:flush") return require("../core/persistence/json-store").flushPersistence(args?.[0]);
    const handler = handlers.get(channel);
    if (!handler) throw Error("Comando PROGRAM indisponível: " + channel);
    return handler({}, ...args);
}
function receive(message) {
    if (message.type === "event-reset") { credits.clear(); audioFlights.length = 0; audioFlightSeconds = 0; audioFlightBytes = 0; }
    if (message.type === "host-reply") {
        const waiting = pending.get(message.id); if (!waiting) return;
        pending.delete(message.id); clearTimeout(waiting.timer);
        if (message.error) waiting.reject(Error(message.error)); else waiting.resolve(message.value);
    }
    if (message.type === "event-ack") {
        if (message.channel === "playout:audio-pcm") {
            const flight = audioFlights.shift();
            if (flight) { audioFlightSeconds = Math.max(0, audioFlightSeconds - flight.seconds); audioFlightBytes = Math.max(0, audioFlightBytes - flight.bytes); }
        }
        credits.set(message.channel, Math.max(0, (credits.get(message.channel) || 0) - 1));
    }
    if (message.type === "notify") listeners.get(message.channel)?.({}, ...message.args);
}
const dialog = Object.fromEntries(["showOpenDialog", "showSaveDialog", "showMessageBox"].map(action =>
    [action, (...args) => hostCall(action, args.at(-1))]));
module.exports = { initialize, invoke, receive, send, hostCall, hostEvents, handlers,
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), on: (channel, handler) => listeners.set(channel, handler) },
    dialog, shell: { openPath: file => hostCall("openPath", { file }) }, BrowserWindow: {}, protocol: {}, session: {} };
