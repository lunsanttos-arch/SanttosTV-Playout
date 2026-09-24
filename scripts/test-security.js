"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root,"src/main/main.js"),"utf8");
const app = fs.readFileSync(path.join(root,"src/renderer/src/App.tsx"),"utf8");
const check = fs.readFileSync(path.join(root,"src/core/media/decode-check.js"),"utf8");

const start = main.indexOf("function isTrustedIpcEvent(event)");
const end = main.indexOf("function createWindow()",start);
assert(start >= 0 && end > start,"IPC security guards must exist");
const handlers = new Map();
const context = {
    mainWindow: null,
    ipcMain: {handle: (channel,handler) => handlers.set(channel,handler)},
    console: {warn: () => {}},
    URL
};
vm.createContext(context);
vm.runInContext(main.slice(start,end),context);

test("Only main window frame may invoke privileged IPC",async()=>{
    const mainFrame = {};
    const webContents = {mainFrame};
    context.mainWindow = {isDestroyed: () => false,webContents};
    const trusted = {sender:webContents,senderFrame:mainFrame};
    assert.equal(context.isTrustedIpcEvent(trusted),true);
    assert.equal(context.isTrustedIpcEvent({sender:webContents,senderFrame:{}}),false);
    assert.equal(context.isTrustedIpcEvent({sender:{},senderFrame:mainFrame}),false);
    context.secureIpcHandle("qa:trusted",(_event,value)=>value+1);
    assert.equal(await handlers.get("qa:trusted")(trusted,3),4);
    await assert.rejects(async()=>handlers.get("qa:trusted")({sender:{},senderFrame:{}},3),/nao autorizada/);
});

test("External navigation and popup windows are denied",()=>{
    assert.equal(context.isAllowedMainNavigation("http://localhost:5173/#playout","http://localhost:5173/"),true);
    assert.equal(context.isAllowedMainNavigation("https://example.com/","http://localhost:5173/"),false);
    assert.equal(context.isAllowedMainNavigation("http://localhost:5173/admin","http://localhost:5173/"),false);
    assert(main.includes('setWindowOpenHandler(() => ({'));
    assert(main.includes('"will-navigate"'));
    assert(main.includes('"will-redirect"'));
});

test("Privileged handlers and frame sender are gated",()=>{
    const direct = main.match(/ipcMain\.handle\(/g) ?? [];
    const protectedHandlers = main.match(/secureIpcHandle\(/g) ?? [];
    assert.equal(direct.length,1,"No unguarded ipcMain.handle handlers");
    assert(protectedHandlers.length > 10);
    assert(main.includes("if (!isTrustedIpcEvent(event))"));
    const frame = main.indexOf('"ndi:frame"');
    const buffer = main.indexOf("Buffer.from(frameData)",frame);
    const precondition = main.indexOf("frameData.byteLength !== NDI_FRAME_SIZE",frame);
    assert(frame > 0 && precondition > frame && precondition < buffer);
});

test("UI, database, and media probe keep security contracts",()=>{
    assert(main.includes("initializeDatabase(app.getPath(\"userData\"))"));
    assert(main.includes("webviewTag: false"));
    assert(main.includes("contextIsolation: true"));
    assert(main.includes("nodeIntegration: false"));
    assert(check.includes("videoStreamIndex !== null"));
    assert(!app.includes("dangerouslySetInnerHTML"));
});

test("Audio 01 remains program even when Audio 02 is default",()=>{
    const {parseProbeResult}=require("../src/core/media/ffprobe");
    const result=parseProbeResult({
      streams:[
        {index:0,codec_type:"audio",codec_name:"aac",channels:2,disposition:{default:0}},
        {index:1,codec_type:"video",codec_name:"h264",width:1920,height:1080,avg_frame_rate:"30000/1001",r_frame_rate:"30000/1001",disposition:{default:1}},
        {index:2,codec_type:"audio",codec_name:"aac",channels:2,disposition:{default:1}}
      ],
      format:{duration:"10.0",format_name:"mp4",bit_rate:"4000000"}
    });
    assert.equal(result.videoStreamIndex,1);
    assert.equal(result.audioStreamIndex,0);
    assert.equal(result.audioTracks[0].role,"program");
    assert.equal(result.audioTracks[1].role,"alternate");
});
