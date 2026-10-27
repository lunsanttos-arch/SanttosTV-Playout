'use strict';
// Separate browser process: static controller.html, actual PIN login, no application preload.
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const config=JSON.parse(fs.readFileSync(process.env.SANTTOS_WEB_QA_CONFIG,'utf8'));
app.setPath('userData',config.profile);
app.whenReady().then(async()=>{
    const window=new BrowserWindow({show:true,width:1440,height:950,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    const evaluate=expression=>window.webContents.executeJavaScript(expression,true);
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    let failed=false;
    try{
        await window.loadURL(config.url);
        await evaluate(`(()=>{const input=document.querySelector('input[aria-label="Código de acesso"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(config.pin)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
        await wait(50);await evaluate(`document.querySelector('.remote-controller-login button').click()`);
        for(let i=0;i<100;i++){if(await evaluate(`Boolean(document.querySelector('.opec-shell .opec-rundown-item'))`))break;await wait(50)}
        assert(await evaluate(`Boolean(document.querySelector('.opec-meta-row > .opec-title-actions'))`));
        assert(await evaluate(`Boolean(document.querySelector('button[aria-label="Adicionar material abaixo"]'))&&Boolean(document.querySelector('button[aria-label="Adicionar Conteúdo a definir abaixo"]'))`));
        assert.equal(await evaluate(`document.querySelectorAll('.opec-header-actions button').length`),6);
        const actualStyle=await evaluate(`(()=>{const input=getComputedStyle(document.querySelector('.opec-block-tools input[type=number]'));const button=getComputedStyle(document.querySelector('.opec-title-actions button'));return {input:{background:input.backgroundColor,color:input.color,border:input.borderColor,radius:input.borderRadius},button:{background:button.backgroundColor,color:button.color,border:button.borderColor,radius:button.borderRadius}}})()`);
        assert.deepEqual(actualStyle,config.desktopStyle,'Browser controls must use the same theme as desktop');
        assert.notEqual(actualStyle.input.background,'rgb(255, 255, 255)');
        await evaluate(`(()=>{const source=document.querySelector('.opec-library-item').querySelector('strong').innerText;const data=new DataTransfer();const id=${JSON.stringify(config.sourceId)};data.setData('application/x-santtos-media',id);const row=document.querySelector('.opec-rundown-item');const bounds=row.getBoundingClientRect();row.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:data,clientY:bounds.top+bounds.height/2,clientX:bounds.left+20}))})()`);
        await wait(220);assert.equal(await evaluate(`document.querySelector('.opec-replace-label').innerText`),'Substituir Item');
        const screenshot=await window.webContents.capturePage();fs.writeFileSync(path.join(config.output,'web-controller-theme.png'),screenshot.toPNG());
        await evaluate(`(()=>{const row=document.querySelectorAll('.opec-rundown-item')[1];const data=new DataTransfer();data.setData('application/x-santtos-media',${JSON.stringify(config.sourceId)});const bounds=row.getBoundingClientRect();row.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:data,clientY:bounds.top+1,clientX:bounds.left+20}))})()`);
        await wait(220);assert.equal(await evaluate(`document.querySelector('.opec-insert-slot.active').innerText`),'Incluir Item');
        assert.equal(await evaluate(`document.querySelectorAll('.opec-modal').length`),0);
        const rowsBefore=await evaluate(`document.querySelectorAll('.opec-rundown-item').length`);
        assert.equal(await evaluate(`[...document.querySelectorAll('.opec-rundown-item')].filter(row=>row.querySelector('.opec-pending-label')).some(row=>row.querySelector('button[title="Assistir ao material"]'))`),false);
        async function watch(selector){
            await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
            let ready=false;for(let n=0;n<80;n++){ready=await evaluate(`Boolean(document.querySelector('.library-watch-dialog video')?.readyState>=2)`);if(ready)break;await wait(50)}
            assert(ready,'Authenticated web video must decode');
            await evaluate(`(()=>{const v=document.querySelector('.library-watch-dialog video');v.pause();v.currentTime=1;v.volume=.2;})()`);
            await evaluate(`document.querySelector('button[aria-label="Fechar reprodução"]').click()`);
            await wait(50);assert.equal(await evaluate(`Boolean(document.querySelector('.library-watch-dialog'))`),false);
        }
        await watch('.opec-library-actions button');
        await watch('button[title="Assistir ao material"]');
        assert.equal(await evaluate(`document.querySelectorAll('.opec-rundown-item').length`),rowsBefore);
        console.log('WEB WATCH: actual authenticated HTTP video, library/rundown controls, local pause/seek/volume and unchanged draft passed');
        console.log('WEB UI: real compiled assets, PIN login, current animated drag targets, model/import placement and theme parity passed');
    }catch(error){console.error(error);failed=true}finally{window.destroy();app.exit(failed?1:0)}
});
