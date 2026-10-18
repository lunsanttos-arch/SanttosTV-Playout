"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { createReadStream } = require("node:fs");
const { execFileSync } = require("node:child_process");

async function digest(file) {
    const hash = crypto.createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest("hex");
}

async function createReleaseKit(root) {
    const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
    const build = path.join(root, "build");
    const unpacked = path.join(build, "win-unpacked");
    const installer = `Santtos-Playout-Setup-${pkg.version}.exe`;
    const resources = ["SanttosTVAutomation.exe", "resources/app.asar",
        "resources/ndi/ndi_test.exe", "resources/ndi/Processing.NDI.Lib.x64.dll",
        "resources/omt/omt_sender.exe", "resources/omt/libomt.dll", "resources/omt/libvmx.dll",
        "resources/runtime/ffmpeg.exe", "resources/runtime/ffprobe.exe", "resources/runtime/manifest.json"];
    const runtimeFiles = await fs.readdir(path.join(unpacked, "resources/runtime"));
    if (!runtimeFiles.some(name => /^LICENSE/i.test(name)) || !runtimeFiles.some(name => /^SOURCE/i.test(name))) {
        throw Error("O runtime deve incluir LICENSE e SOURCE com licença e origem do build distribuído.");
    }
    for (const name of runtimeFiles.filter(name => /^(LICENSE|SOURCE)/i.test(name))) resources.push(`resources/runtime/${name}`);
    const inventory = [];
    for (const name of resources) {
        const file = path.join(unpacked, name);
        const stat = await fs.stat(file);
        if (!stat.isFile() || stat.size === 0) throw Error(`Componente ausente ou vazio: ${name}`);
        inventory.push({ path: name, bytes: stat.size, sha256: await digest(file) });
    }
    const expected = JSON.parse(await fs.readFile(path.join(unpacked, "resources/runtime/manifest.json"), "utf8"));
    for (const name of ["ffmpeg", "ffprobe"]) {
        if (inventory.find(entry => entry.path === `resources/runtime/${name}.exe`).sha256 !== expected[`${name}Sha256`]) {
            throw Error(`Runtime empacotado difere do manifest: ${name}`);
        }
    }
    const packed = JSON.parse(await fs.readFile(path.join(root, "node_modules/@electron/asar/package.json"), "utf8"));
    // Read the package actually shipped, rather than trusting a stale build directory.
    const asar = require(path.join(root, "node_modules/@electron/asar"));
    asar.uncache(path.join(unpacked, "resources/app.asar"));
    const shipped = JSON.parse(asar.extractFile(path.join(unpacked, "resources/app.asar"), "package.json").toString());
    if (shipped.version !== pkg.version || shipped.name !== pkg.name) throw Error("Pacote instalado não corresponde à versão solicitada.");
    const installerPath = path.join(build, installer);
    const stat = await fs.stat(installerPath);
    if (!stat.isFile() || stat.size === 0) throw Error("Instalador ausente ou vazio.");
    const installerHash = await digest(installerPath);
    let commit = null;
    try { commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch {}
    const destination = path.join(build, `release-${pkg.version}`);
    // Never overwrite an already assembled candidate with potentially different binaries.
    await fs.mkdir(destination);
    try {
        await fs.copyFile(installerPath, path.join(destination, installer));
        await fs.copyFile(path.join(root, "docs/INSTALACAO-LITE.md"), path.join(destination, "INSTALACAO-LITE.md"));
        await fs.copyFile(path.join(root, "docs/HOMOLOGACAO-WINDOWS.md"), path.join(destination, "HOMOLOGACAO-WINDOWS.md"));
        await fs.copyFile(path.join(root, "package-lock.json"), path.join(destination, "package-lock.json"));
        await fs.writeFile(path.join(destination, "release.json"), JSON.stringify({
            product: "SanTTos Playout Lite", version: pkg.version, commit, platform: "win32", arch: "x64",
            createdAt: new Date().toISOString(), status: "candidate-not-homologated",
            signature: "Verify Authenticode on Windows; hashes do not establish publisher identity.",
            asarToolVersion: packed.version, lockSha256: await digest(path.join(root, "package-lock.json")),
            installer: { path: installer, bytes: stat.size, sha256: installerHash }, components: inventory
        }, null, 2));
        const names = [installer, "release.json", "package-lock.json", "INSTALACAO-LITE.md", "HOMOLOGACAO-WINDOWS.md"];
        const sums = [];
        for (const name of names) sums.push(`${await digest(path.join(destination, name))}  ${name}`);
        await fs.writeFile(path.join(destination, "SHA256SUMS.txt"), sums.join("\n") + "\n");
    } catch (error) { await fs.rm(destination, { recursive: true, force: true }); throw error; }
    return destination;
}
if (require.main === module) createReleaseKit(path.resolve(__dirname, "..")).then(folder => console.log(`Candidato Lite preparado: ${folder}`)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { createReleaseKit };
