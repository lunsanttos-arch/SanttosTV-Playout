"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const { EventEmitter } = require("node:events");
const ipc = new EventEmitter(), sent = []; let api;
ipc.send = (...args) => sent.push(args);
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/main/preload.js"), "utf8"), {
    require: name => {
        assert.equal(name, "electron");
        return { ipcRenderer: ipc, webUtils: {}, contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } } };
    }
});
for (const [channel, subscribe] of [["playout:preview-frame", "onProgramPreviewFrame"], ["playout:audio-pcm", "onProgramAudioPcm"]]) {
    const ackCount = () => sent.filter(args => args[0] === "program:monitor-ack" && args[1] === channel).length;
    ipc.emit(channel, {}, { sequence: 1 });
    assert.equal(ackCount(), 1, "Frames received before React mounts must release their transport credit");
    let deliveries = 0;
    const off1 = api[subscribe](() => deliveries++), off2 = api[subscribe](() => deliveries++);
    ipc.emit(channel, {}, { sequence: 2 });
    assert.equal(deliveries, 2); assert.equal(ackCount(), 2, "Multiple subscribers must ACK only once per message");
    off1(); off2(); ipc.emit(channel, {}, { sequence: 3 });
    assert.equal(ackCount(), 3, "Closing a monitor must not permanently consume its transport credit");
    const off3 = api[subscribe](() => deliveries++);
    ipc.emit(channel, {}, { sequence: 4 }); off3();
    assert.equal(deliveries, 3); assert.equal(ackCount(), 4, "Reopening a monitor must receive frames again");
}
console.log("MONITOR DELIVERY: pre-mount, multiple subscribers, unmount and reopen release exactly one transport credit per message passed");
