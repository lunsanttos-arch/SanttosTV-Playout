"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawn, spawnSync} = require("node:child_process");

async function main() {
    if (process.platform !== "win32") {
        console.log("NDI stub integration runs on the Windows CI runner.");
        return;
    }
    const root = path.resolve(__dirname,"..");
    const vswhere = path.join(
        process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
        "Microsoft Visual Studio","Installer","vswhere.exe"
    );
    const vs = spawnSync(vswhere, [
        "-latest","-products","*",
        "-requires","Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
        "-property","installationPath"
    ],{encoding:"utf8"});
    assert.equal(vs.status,0,"MSVC Build Tools não disponíveis.");
    const vsPath=vs.stdout.trim();
    assert(vsPath,"Visual Studio sem C++ x64.");
    const vcvars=path.join(vsPath,"VC","Auxiliary","Build","vcvars64.bat");
    const temp=fs.mkdtempSync(path.join(os.tmpdir(),"santtos-native-qa-"));
    try {
        const exe=path.join(temp,"ndi-test-stub.exe");
        const obj=path.join(temp,"ndi-test-stub.obj");
        const source=path.join(root,"src","core","ndi","ndi_test.cpp");
        const include=path.join(root,"tests","native","stub");
        assert(fs.existsSync(vcvars),"vcvars64.bat ausente: "+vcvars);
        const command=[
            "@echo off",
            `call "${vcvars}" >nul`,
            "if errorlevel 1 exit /b 1",
            `cl /nologo /EHsc /std:c++17 /I"${include}" /c "${source}" /Fo:"${obj}"`,
            "if errorlevel 1 exit /b 1",
            `link /nologo "${obj}" /OUT:"${exe}"`
        ].join("\\r\\n");
        const script=path.join(temp,"compile-ndi-qa.cmd");
        fs.writeFileSync(script,command+"\\r\\n","utf8");
        const build=spawnSync("cmd.exe",["/d","/c",script],{
            cwd:root,windowsHide:true,encoding:"utf8",timeout:120000
        });
        if(build.status!==0) {
            console.error(build.stdout,build.stderr);
            throw new Error("Compilação NDI stub reprovada (exit "+build.status+").");
        }

        const proc=spawn(exe,[],{windowsHide:true,stdio:["pipe","pipe","pipe"]});
        let output="",errorOutput="";
        proc.stdout.on("data",chunk=>output+=chunk.toString());
        proc.stderr.on("data",chunk=>errorOutput+=chunk.toString());
        async function waitFor(predicate,label,timeout=9000) {
            const until=Date.now()+timeout;
            while(Date.now()<until) {
                if(predicate())return;
                if(proc.exitCode!==null)throw new Error(label+": engine saiu cedo "+proc.exitCode+" "+errorOutput);
                await new Promise(r=>setTimeout(r,50));
            }
            throw new Error("Timeout: "+label+" / "+output+" / "+errorOutput);
        }
        await waitFor(()=>output.includes("NDI ONLINE:"),"NDI online");
        const frame=Buffer.alloc(1920*1080*4,0);
        const send=()=>new Promise((resolve,reject)=>{
            proc.stdin.write(frame,err=>err?reject(err):resolve());
        });
        await send();
        await send();
        await waitFor(()=>output.includes("FRAME_ACK 2"),"2 PROGRAM frames acknowledged");
        // Wait long enough for the idle thread to send a black fallback.
        await waitFor(()=>output.split("NDI_STUB_SEND").length-1>=4,"idle black fallback",7000);
        assert(output.includes("NDI HEARTBEAT"),"Heartbeat NDI must stay alive without input");
        proc.stdin.end();
        const exitCode=await Promise.race([
            new Promise(resolve=>proc.once("exit",resolve)),
            new Promise((_,reject)=>setTimeout(()=>reject(new Error("NDI sender did not exit")),5000))
        ]);
        assert.equal(exitCode,0,"Sender must exit cleanly");
        console.log("NATIVE NDI QA: APROVADO (compile, two frames, ack, heartbeat, black fallback)");
    } finally {
        fs.rmSync(temp,{recursive:true,force:true});
    }
}
main().catch(e=>{console.error(e);process.exit(1)});
