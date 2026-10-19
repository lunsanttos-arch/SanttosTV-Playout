'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'santtos-explorer-drop-'));
    const pages = await (await fetch('http://127.0.0.1:9333/json')).json();
    const ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
    let serial = 0; const pending = new Map();
    ws.addEventListener('message', event => { const result = JSON.parse(event.data); pending.get(result.id)?.(result); pending.delete(result.id); });
    async function send(method, params) {
        const id = ++serial; const reply = new Promise(resolve => pending.set(id, resolve));
        ws.send(JSON.stringify({ id, method, params })); const result = await reply;
        if (result.error) throw Error(JSON.stringify(result.error)); return result.result;
    }
    async function evaluate(expression) {
        const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description); return result.result.value;
    }
    async function click(text) { await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()===${JSON.stringify(text)})||[...document.querySelectorAll('button')].find(b=>b.innerText.includes(${JSON.stringify(text)}));if(!b)throw Error('Missing button');b.click()})()`); await wait(120); }
    async function until(expression) { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await wait(100); } throw Error('Condition timeout: ' + expression); }
    async function drop(files, selector, fraction = .5) {
        const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width*.5,y:r.top+r.height*${fraction}}})()`);
        const data = { items: [], files, dragOperationsMask: 1 };
        await send('Input.dispatchDragEvent', { type: 'dragEnter', ...point, data });
        await send('Input.dispatchDragEvent', { type: 'dragOver', ...point, data });
        await wait(180);
        if (selector === '.opec-rundown-item') assert(await evaluate(`Boolean(document.querySelector('.opec-replace-label'))`));
        await send('Input.dispatchDragEvent', { type: 'drop', ...point, data });
    }
    try {
        const seed = await evaluate(`(async()=>{const source=(await window.santtosAPI.getMedia())[0];const d=new Date();const date=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');const old=await window.santtosAPI.getDailyRundown(date);await window.santtosAPI.saveDailyRundown({date,expectedUpdatedAt:old.updatedAt,title:'Explorer QA',startTime:'06:00',items:[{placeholder:true,rundownItemId:'slot',duration:60,blockLabel:'001',notes:'Keep notes'}]});return {source,date}})()`);
        const first = path.join(folder, '101 PRIMEIRO.mp4'), second = path.join(folder, '102 SEGUNDO.mp4');
        fs.copyFileSync(seed.source.path, first); fs.copyFileSync(seed.source.path, second);
        await evaluate('setTimeout(()=>location.reload(),0)'); await wait(700); await click('Programação');
        await until(`document.querySelectorAll('.opec-rundown-item').length===1`);
        await drop([first], '.opec-rundown-item');
        await until(`document.querySelector('.opec-rundown-item')?.innerText.includes('PRIMEIRO')`);
        await click('Salvar programação');
        let saved = await evaluate(`window.santtosAPI.getDailyRundown(${JSON.stringify(seed.date)})`);
        assert.equal(saved.items[0].notes, 'Keep notes'); assert.equal(saved.items[0].blockLabel, '001'); assert.equal(saved.items[0].replacedPlaceholder, true);
        await click('Desfazer');
        assert(await evaluate(`document.querySelector('.opec-rundown-item').classList.contains('opec-pending-item')`));
        // One known library file plus a new one; order and one-step undo must survive asynchronous import.
        await drop([second, first], '.opec-insert-slot.at-end');
        await until(`document.querySelectorAll('.opec-rundown-item').length===3`);
        const names = await evaluate(`[...document.querySelectorAll('.opec-rundown-item')].map(el=>el.querySelector('.opec-item-main > strong')?.innerText||'')`);
        assert(names[1].includes('SEGUNDO')); assert(names[2].includes('PRIMEIRO'));
        await click('Desfazer'); assert.equal(await evaluate(`document.querySelectorAll('.opec-rundown-item').length`), 1);
        // Empty list is also a valid target.
        await evaluate(`document.querySelector('.opec-remove').click()`); await wait(100);
        await drop([first], '.opec-rundown-list');
        await until(`document.querySelectorAll('.opec-rundown-item').length===1&&document.querySelector('.opec-rundown-item').innerText.includes('PRIMEIRO')`);
        assert(!(await evaluate('window.santtosAPI.getMedia()')).some(item => item.path === first || item.path === second), 'One-off files must never enter the library');
        await click('Salvar programação');
        await evaluate('setTimeout(()=>location.reload(),0)'); await wait(700); await click('Programação');
        await until(`document.querySelector('.opec-rundown-item')?.innerText.includes('PRIMEIRO')`);
        await evaluate(`document.querySelector('button[title="Assistir ao material"]').click()`);
        await until(`document.querySelector('.library-watch-dialog video')?.readyState>=2`);
        await evaluate(`document.querySelector('button[aria-label="Fechar reprodução"]').click()`);
        saved = await evaluate(`window.santtosAPI.getDailyRundown(${JSON.stringify(seed.date)})`);
        const applied = await evaluate(`window.santtosAPI.applyNativeRundown(${JSON.stringify(saved.items.map(item => ({...item,id:item.rundownItemId})))})`);
        assert.equal(applied.ok, true);
        const item = saved.items[0];
        await evaluate(`window.santtosAPI.playNdiFile(${JSON.stringify(item.path)},0,'',${JSON.stringify({itemId:item.rundownItemId,inPointSeconds:0,outPointSeconds:3})})`);
        await until(`(async()=>{const s=(await window.santtosAPI.getNdiStatus()).playout;return s.state==='PLAYING'&&s.itemId===${JSON.stringify(item.rundownItemId)}})()`);
        assert(!(await evaluate('window.santtosAPI.getMedia()')).some(item => item.path === first || item.path === second));
        console.log('Explorer → Programação: native file drop, import, existing media, replacement metadata, ordered multi-file insertion, empty list and undo OK.');
    } finally { ws.close(); fs.rmSync(folder, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
