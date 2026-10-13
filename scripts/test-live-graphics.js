"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { LiveGraphics, filterPath } = require("../src/core/playout/live-graphics");
const { FixedFrameAssembler } = require("../src/core/ndi/frame-aligner");
const ffmpeg = process.env.FFMPEG_BIN || require("ffmpeg-static");
const font = ["C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"].find(fs.existsSync);
assert(font, "A readable test font is required");
const profiles = [[320,180,25],[640,360,30000/1001],[1280,720,60]];
(async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "santtos-gc-stress-"));
    const results = [];
    try {
        const logo = path.join(folder,"logo.png"), larger = path.join(folder,"larger.png");
        for (const [file,size] of [[logo,"32x32"],[larger,"80x48"]]) execFileSync(ffmpeg,
            ["-v","error","-f","lavfi","-i",`color=white:s=${size}`,"-frames:v","1","-threads","1","-y",file]);
        for (const [width,height,fps] of profiles) {
            const gc = new LiveGraphics({ logoPath:logo });
            let count=0, lit=0, dark=0, last=0, maxGap=0, burst=false, requested=0, stderr="";
            const child = spawn(ffmpeg,["-hide_banner","-loglevel","warning","-stdin","-re","-f","lavfi","-i",`color=black:s=${width}x${height}:r=${fps}`,
                "-loop","1","-reinit_filter:v","0","-threads","1","-i",gc.logoFile,"-filter_complex_threads","2","-filter_complex",
                `[0:v][1:v]overlay@program_logo=enable=0:x=0:y=0,drawtext@program_hashtag=text=' ':expansion=none:fontfile='${filterPath(font)}':x=100:y=70:fontsize=16:fontcolor=white,drawtext@program_identification=text='ESTREIA':enable=0:fontfile='${filterPath(font)}':x=180:y=100:fontsize=16:fontcolor=white`,
                "-t","8","-pix_fmt","rgb24","-f","rawvideo","pipe:1"],{windowsHide:true,stdio:["pipe","pipe","pipe"]});
            gc.attach(child); child.stderr.on("data",chunk=>{stderr=(stderr+chunk).slice(-5000)});
            const assembler = new FixedFrameAssembler(width*height*3,frame=>{
                count++; const now=performance.now(); if(last)maxGap=Math.max(maxGap,now-last);last=now;
                if(frame[(5*width+5)*3]>200)lit++;else dark++;
                if(count===Math.round(fps*.8)){gc.logo(true);requested++;}
                if(count===Math.round(fps*1.4)){gc.text("#O'Brien : ç 日本 [x] %{pts} ");requested++;}
                if(count===Math.round(fps*2)){gc.style({fontsize:24,x:110,fontcolor:"white"});requested+=3;}
                if(count===Math.round(fps*2.6)){gc.image(fs.readFileSync(larger));requested++;}
                if(count===Math.round(fps*3)){gc.logo(false);requested++;}
                if(count===Math.round(fps*3.6)){
                    for(let i=0;i<2000;i++){gc.logo(Boolean(i%2));gc.text("#"+i+" 😀".repeat(i%80));requested+=2;}
                    gc.logo(true);gc.text("#Final correto\nq\r\0");requested+=2;burst=true;
                    assert(gc.pending.size<20,"Rapid edits must coalesce into a bounded queue");
                }
                if(count===Math.round(fps*5)){gc.command("drawtext@program_identification","enable","1");requested++;}
                if(count===Math.round(fps*6)){gc.command("drawtext@program_identification","text","AO VIVO");requested++;}
            });
            child.stdout.on("data",chunk=>assembler.push(chunk));
            const timeout=setTimeout(()=>child.kill("SIGKILL"),16000);
            const code=await new Promise((resolve,reject)=>{child.once("error",reject);child.once("close",resolve)});
            clearTimeout(timeout);
            const status=gc.snapshot();gc.stop();assembler.stop();
            assert.equal(code,0,stderr);assert.equal(status.errors,0,stderr);assert(burst&&lit>10&&dark>10,"Both logo states must actually reach video pixels");
            assert(Math.abs(count-Math.ceil(8*fps))<=1,`Lost PROGRAM frames: ${count}`);
            assert(maxGap<250,`Live graphics stalled video for ${maxGap.toFixed(1)}ms`);
            results.push({width,height,fps,frames:count,requested,commands:status.commands,maxFrameGapMs:Number(maxGap.toFixed(1)),errors:status.errors});
        }
        const report = { scenarios:results, requestedUpdates:results.reduce((sum,r)=>sum+r.requested,0) };
        fs.writeFileSync(path.join(os.tmpdir(),"santtos-live-graphics-results.json"),JSON.stringify(report,null,2));
        console.log("LIVE GRAPHICS STRESS: "+JSON.stringify(report));
    } finally {fs.rmSync(folder,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1});
