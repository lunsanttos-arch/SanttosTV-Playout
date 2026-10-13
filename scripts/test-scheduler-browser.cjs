"use strict";
// Requires Vite + Electron debug port 9333 and an isolated browser debug port 9334.
const assert = require("node:assert/strict");
const path = require("node:path");
const { SchedulingWebController } = require("../src/core/scheduling/web-controller");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const media = ["Anuncio Poa 24h.mp4", "Chamada 001.mp4", "vinheta.mp4", "513-22PL_VT_FED05.mp4"].map((name, i) => ({
    id: `layout-${i}`, name, path: `C:/QA/${i % 2 ? "Chamadas" : "Comerciais"}/${name}`,
    extension: "mp4", duration: 30, fileSize: 1, status: "ready", createdAt: new Date().toISOString()
}));
async function attach(port) {
    const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const ws = new WebSocket(pages.find(page => page.type === "page").webSocketDebuggerUrl);
    await new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));
    let id = 0; const pending = new Map();
    ws.addEventListener("message", event => { const data = JSON.parse(event.data); if (pending.has(data.id)) {
        pending.get(data.id)(data); pending.delete(data.id);
    } });
    const send = (method, params = {}) => new Promise(resolve => { const key = ++id; pending.set(key, resolve); ws.send(JSON.stringify({ id: key, method, params })); });
    return { send, close: () => ws.close(), evaluate: async expression => {
        const result = (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result;
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || "Browser evaluation failed");
        return result.result.value;
    } };
}
async function exercise(client, name) {
    await client.evaluate(`(()=>{window.testDrop=(source,target)=>{const transfer=new DataTransfer();source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer}));target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));source.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:transfer}));};return true})()`);
    for (let i = 0; i < 4; i++) {
        await client.evaluate(`window.testDrop(document.querySelectorAll('.opec-library-item')[${i}],document.querySelector('.opec-rundown-list'))`);
        await delay(40);
    }
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.innerText.includes('Conteúdo a definir')).click()`);
    await delay(60);
    const geometry = await client.evaluate(`(()=>{const rows=[...document.querySelectorAll('.opec-rundown-item')];return {count:rows.length,valid:rows.every((row,index)=>{const box=row.getBoundingClientRect();return [...row.querySelectorAll('input,select,strong')].every(field=>{const rect=field.getBoundingClientRect();return rect.top>=box.top && rect.bottom<=box.bottom+1 && rect.right<=box.right+1;}) && (!index || rows[index-1].getBoundingClientRect().bottom<=box.top);})}})()`);
    assert(geometry.count === 5 && geometry.valid, `${name}: rows overlap or fields escape: ${JSON.stringify(geometry)}`);
    assert.equal(await client.evaluate(`document.querySelectorAll('.opec-rundown-item select,.opec-rundown-item input[type=checkbox]').length`), 0, "OPEC must not expose material selectors or logo controls");
    assert(await client.evaluate(`Array.from(document.querySelectorAll('.opec-rundown-item')).every(row=>row.getBoundingClientRect().height<=90)`), "OPEC rows must stay compact");
    await client.evaluate(`window.testDrop(document.querySelectorAll('.opec-library-item')[1],document.querySelectorAll('.opec-rundown-item')[4])`);
    await delay(40);
    assert.equal(await client.evaluate(`document.querySelectorAll('.opec-rundown-item')[4].querySelector('strong').textContent`), media[1].name);
    assert.equal(await client.evaluate(`document.querySelectorAll('.opec-rundown-item').length`), 5, "Replace must preserve slot");
    await client.evaluate(`window.testDrop(document.querySelectorAll('.opec-rundown-item')[4],document.querySelectorAll('.opec-rundown-item')[0])`);
    await delay(40);
    assert.equal(await client.evaluate(`document.querySelectorAll('.opec-rundown-item')[0].querySelector('strong').textContent`), media[1].name);
    await client.evaluate(`window.testDrop(document.querySelectorAll('.opec-library-item')[2],document.querySelectorAll('.opec-rundown-item')[1])`);
    await delay(40);
    assert.equal(await client.evaluate(`document.querySelectorAll('.opec-rundown-item')[1].querySelector('strong').textContent`), media[2].name);
    await client.evaluate(`window.testDrop(document.querySelectorAll('.opec-rundown-item')[0],document.querySelector('.opec-drop-end'))`);
    await delay(40);
    assert.equal(await client.evaluate(`document.querySelectorAll('.opec-rundown-item')[5].querySelector('strong').textContent`), media[1].name);
    await client.evaluate(`window.testDrop(document.querySelectorAll('.opec-rundown-item')[0],document.querySelectorAll('.opec-rundown-item')[4])`);
    await delay(40);
    assert.equal(await client.evaluate(`document.querySelectorAll('.opec-rundown-item')[3].querySelector('strong').textContent`), media[2].name, "Downward move must honor the insertion marker");
    console.log(`${name}: five-card layout, library drop, insertion, placeholder replacement and reorder passed`);
}
(async () => {
    let native, remote, server;
    try {
        native = await attach(9333);
        await native.send("Page.reload"); await delay(500);
        await native.evaluate(`(async()=>{const entry=await(await fetch('/src/main.tsx')).text();
            const React=(await import(entry.match(/from "([^"]+react\\.js[^\\"]*)"/)[1])).default;
            const {createRoot}=(await import(entry.match(/from "([^"]+react-dom_client\\.js[^\\"]*)"/)[1])).default;
            const {default:Panel}=await import('/src/OpecSchedulerPanel.tsx');
            document.querySelector('#root').style.display='none';const host=document.createElement('div');host.style.cssText='height:100vh;padding:18px;box-sizing:border-box';document.body.append(host);
            window.schedulerTestRoot=createRoot(host);window.schedulerTestRoot.render(React.createElement(Panel,{media:${JSON.stringify(media)},onApply:()=>{}}));return true})()`);
        await delay(500);
        // Remove only fixture-rendered items, without saving any changes to master data.
        while (await native.evaluate(`document.querySelectorAll('.opec-rundown-item').length`)) {
            await native.evaluate(`document.querySelector('.opec-remove').click()`); await delay(30);
        }
        await exercise(native, "Desktop");
        server = new SchedulingWebController({ port: 0, distFolder: path.resolve(__dirname, "../dist"), getMedia: () => media,
            getCategories: () => [{ id: "ads", name: "Comerciais", folderPath: "C:\\QA\\Comerciais" }, { id: "calls", name: "Chamadas", folderPath: "C:\\QA\\Chamadas" }],
            getRundown: date => ({ date, title: "QA", startTime: "00:00", items: [], updatedAt: null }), saveRundown: value => value });
        const state = await server.start();
        remote = await attach(9334); await remote.send("Page.navigate", { url: `http://127.0.0.1:${state.port}/controller` }); await delay(500);
        await remote.evaluate(`(()=>{const input=document.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(state.pin)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
        await delay(30); await remote.evaluate(`document.querySelector('button').click()`); await delay(500);
        await exercise(remote, "Browser");
        const screenshot = (await remote.send("Page.captureScreenshot", { format: "png" })).result.data;
        require("node:fs").writeFileSync("/tmp/scheduler-fixed.png", Buffer.from(screenshot, "base64"));
        await remote.evaluate(`document.querySelectorAll('[role=tab]')[1].click()`); await delay(40);
        assert.equal(await remote.evaluate(`document.querySelectorAll('.opec-library-item').length`), 2);
        assert(await remote.evaluate(`Array.from(document.querySelectorAll('.opec-library-item strong')).every(item=>['${media[0].name}','${media[2].name}'].includes(item.textContent))`));
        await remote.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 800, deviceScaleFactor: 1, mobile: false });
        await delay(100);
        assert(await remote.evaluate(`document.documentElement.scrollWidth<=window.innerWidth`), "Narrow window must not overflow horizontally");
        console.log("Folder tabs filter Windows paths; responsive browser layout passed");
    } finally {
        if (native) { await native.send("Page.reload"); native.close(); }
        if (remote) { await remote.send("Emulation.clearDeviceMetricsOverride"); await remote.send("Page.navigate", { url: "about:blank" }); remote.close(); }
        server?.stop();
    }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
