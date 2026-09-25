"use strict";

/**
 * Build the native NDI sender on Windows with the locally licensed NDI SDK.
 * The runtime is copied beside the engine and packaged via extraResources.
 * This script intentionally does not download/redistribute NDI components.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const target = path.join(root, "src", "core", "ndi");
const source = path.join(target, "ndi_test.cpp");
const executable = path.join(target, "ndi_test.exe");
const runtimeTarget = path.join(target, "Processing.NDI.Lib.x64.dll");

function fail(message) {
    throw new Error("[NDI BUILD] " + message);
}

function lookupSdk() {
    const candidates = [
        process.env.NDI_SDK_DIR,
        path.join(process.env.ProgramFiles || "C:\\Program Files", "NDI", "NDI 6 SDK")
    ].filter(Boolean);
    for (const sdk of candidates) {
        const include = path.join(sdk, "Include", "Processing.NDI.Lib.h");
        const library = path.join(sdk, "Lib", "x64", "Processing.NDI.Lib.x64.lib");
        const runtime = path.join(sdk, "Bin", "x64", "Processing.NDI.Lib.x64.dll");
        if ([include, library, runtime].every((file) => fs.existsSync(file))) {
            return { sdk, include: path.dirname(include), library: path.dirname(library), runtime };
        }
    }
    fail("SDK 6 completo nao encontrado. Instale o NDI 6 SDK oficial e configure NDI_SDK_DIR. Sao necessarios Include, Lib/x64 e Bin/x64.");
}

function findMsvc() {
    const rootVs = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const vswhere = path.join(rootVs, "Microsoft Visual Studio", "Installer", "vswhere.exe");
    if (!fs.existsSync(vswhere)) {
        fail("Visual Studio Build Tools C++ x64 ausente. Instale Desktop development with C++.");
    }
    const result = spawnSync(vswhere, [
        "-latest",
        "-products", "*",
        "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
        "-property", "installationPath"
    ], { encoding: "utf8", windowsHide: true });
    const installation = result.stdout?.trim();
    if (result.status !== 0 || !installation) {
        fail("O Visual Studio nao possui o workload C++ x64.");
    }
    const vcvars = path.join(installation, "VC", "Auxiliary", "Build", "vcvars64.bat");
    if (!fs.existsSync(vcvars)) fail("vcvars64.bat nao encontrado: " + vcvars);
    return vcvars;
}

function quote(file) {
    return '"' + file.replaceAll('"', "") + '"';
}

function build() {
    if (process.platform !== "win32") {
        fail("Compile o sender NDI num PC Windows x64 com o NDI SDK instalado.");
    }
    const sdk = lookupSdk();
    const vcvars = findMsvc();
    const object = path.join(target, "ndi_test.obj");
    const command = [
        "@echo off",
        "call " + quote(vcvars) + " >nul",
        "if errorlevel 1 exit /b 1",
        "cl /nologo /EHsc /std:c++17 /O2 /I" + quote(sdk.include) +
          " /c " + quote(source) + " /Fo:" + quote(object),
        "if errorlevel 1 exit /b 1",
        "link /nologo " + quote(object) + " /OUT:" + quote(executable) +
          " /LIBPATH:" + quote(sdk.library) + " Processing.NDI.Lib.x64.lib"
    ].join("\r\n");
    const script = path.join(target,"build-native-ndi.cmd");
    fs.writeFileSync(script, command + "\r\n", "utf8");
    console.log("[NDI BUILD] Compilando sender nativo com SDK:", sdk.sdk);
    let result;
    try {
        result = spawnSync("cmd.exe", ["/d", "/c", script], {
            cwd: target, stdio: "inherit", windowsHide: true
        });
    } finally {
        fs.rmSync(script,{force:true});
    }
    if (result.status !== 0) fail("Falha ao compilar/vincular ndi_test.cpp (exit " + result.status + ").");
    fs.copyFileSync(sdk.runtime, runtimeTarget);
    if (![executable, runtimeTarget].every((file) => fs.statSync(file).size > 0)) {
        fail("Artefatos do sender NDI ausentes ou vazios.");
    }
    console.log("[NDI BUILD] OK: sender e DLL na pasta src/core/ndi.");
}

build();
