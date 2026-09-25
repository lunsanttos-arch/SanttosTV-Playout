"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildMediaUrl, resolveMediaRequest } = require("../src/core/media/media-protocol");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "santtos-security-"));
try {
    const allowed = path.join(root, "comercial.mp4");
    const notImported = path.join(root, "segredo.mp4");
    fs.writeFileSync(allowed, "teste");
    fs.writeFileSync(notImported, "privado");
    const library = [{ id: "media-1", path: allowed }];
    const allowedUrl = buildMediaUrl(allowed);

    assert.equal(resolveMediaRequest(allowedUrl, library), fs.realpathSync(allowed));
    assert.equal(resolveMediaRequest(buildMediaUrl(notImported), library), null);
    assert.equal(resolveMediaRequest("file:///etc/passwd", library), null);
    assert.equal(resolveMediaRequest("santtos-media://evil/video?path=" + encodeURIComponent(allowed), library), null);
    assert.equal(resolveMediaRequest("santtos-media://local/../etc?path=" + encodeURIComponent(allowed), library), null);
    assert.equal(resolveMediaRequest(allowedUrl + "&extra=1", library), null);
    assert.equal(resolveMediaRequest(allowedUrl.replace("comercial.mp4", "segredo.mp4"), library), null);
    assert.equal(buildMediaUrl("relative.mp4"), "");
    assert.equal(resolveMediaRequest("santtos-media://local/video?path=%00", library), null);

    const main = fs.readFileSync(path.join(__dirname, "../src/main/main.js"), "utf8");
    const preload = fs.readFileSync(path.join(__dirname, "../src/main/preload.js"), "utf8");
    const index = fs.readFileSync(path.join(__dirname, "../src/renderer/index.html"), "utf8");
    assert(main.includes("webSecurity: true"), "webSecurity deve permanecer habilitado.");
    assert(main.includes("sandbox: true"), "Renderer deve rodar em sandbox.");
    assert(main.includes("registerTrustedHandle("), "Handlers IPC devem validar remetente.");
    assert(!main.includes("webSecurity: false"), "Proibido desabilitar seguranca da web.");
    assert(!preload.includes("pathToFileURL"), "Preload nao deve expor file:// arbitrario.");
    assert(index.includes('http-equiv="Content-Security-Policy"'), "CSP ausente.");

    console.log("SECURITY QA: APROVADO");
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
