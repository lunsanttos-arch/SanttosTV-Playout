"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createPackage } = require("@electron/asar");
const { createHash } = require("node:crypto");
const { createReleaseKit } = require("./create-release-kit");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "santtos-release-kit-"));
    const write = async (name, bytes) => { const file = path.join(root, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes); };
    try {
        await fs.symlink(path.resolve(__dirname, "../node_modules"), path.join(root, "node_modules"), process.platform === "win32" ? "junction" : "dir");
        const pkg = { name: "santtos-tv-playout", version: "1.2.3-test" };
        await write("package.json", JSON.stringify(pkg)); await write("package-lock.json", "{}");
        await write("app/package.json", JSON.stringify(pkg));
        await fs.mkdir(path.join(root, "build/win-unpacked/resources"), { recursive: true });
        await createPackage(path.join(root, "app"), path.join(root, "build/win-unpacked/resources/app.asar"));
        for (const name of ["SanttosTVAutomation.exe", "resources/ndi/ndi_test.exe", "resources/ndi/Processing.NDI.Lib.x64.dll",
            "resources/omt/omt_sender.exe", "resources/omt/libomt.dll", "resources/omt/libvmx.dll", "resources/runtime/ffmpeg.exe", "resources/runtime/ffprobe.exe"])
            await write(`build/win-unpacked/${name}`, "fixture");
        await write("build/win-unpacked/resources/runtime/manifest.json", JSON.stringify({ ffmpegSha256: sha("fixture"), ffprobeSha256: sha("fixture") }));
        for (const name of ["INSTALACAO-LITE.md", "HOMOLOGACAO-WINDOWS.md"]) await write(`docs/${name}`, "fixture guide");
        await write("build/Santtos-Playout-Setup-1.2.3-test.exe", "fixture installer");
        await assert.rejects(createReleaseKit(root), /LICENSE e SOURCE/);
        await write("build/win-unpacked/resources/runtime/LICENSE.txt", "fixture license");
        await write("build/win-unpacked/resources/runtime/SOURCE.txt", "fixture source");
        await write("build/win-unpacked/resources/runtime/ffmpeg.exe", "tampered");
        await assert.rejects(createReleaseKit(root), /difere do manifest/);
        await write("build/win-unpacked/resources/runtime/ffmpeg.exe", "fixture");
        await write("app/package.json", JSON.stringify({ ...pkg, version: "old" }));
        await createPackage(path.join(root, "app"), path.join(root, "build/win-unpacked/resources/app.asar"));
        await assert.rejects(createReleaseKit(root), /não corresponde/);
        await write("app/package.json", JSON.stringify(pkg));
        await createPackage(path.join(root, "app"), path.join(root, "build/win-unpacked/resources/app.asar"));
        const folder = await createReleaseKit(root);
        const manifest = JSON.parse(await fs.readFile(path.join(folder, "release.json")));
        assert.equal(manifest.status, "candidate-not-homologated");
        assert.equal(manifest.installer.sha256, sha("fixture installer"));
        assert.equal(manifest.components.length, 12);
        for (const line of (await fs.readFile(path.join(folder, "SHA256SUMS.txt"), "utf8")).trim().split("\n")) {
            const [hash, file] = line.split("  "); assert.equal(sha(await fs.readFile(path.join(folder, file))), hash);
        }
        await assert.rejects(createReleaseKit(root), { code: "EEXIST" });
        assert.equal(JSON.parse(await fs.readFile(path.join(folder, "release.json"))).version, pkg.version);
        console.log("Release kit: hashes, shipped version, runtime integrity, provenance files and overwrite protection OK (synthetic package; not Windows installer validation).");
    } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
