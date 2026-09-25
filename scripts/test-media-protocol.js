"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
    mediaUrl, decodeMediaUrl, parseRange, createMediaProtocolHandler
} = require("../src/main/media-protocol");

test("Media scheme enforces library allowlist and browser byte-range seek", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "santtos-media-protocol-"));
    try {
        const video = path.join(tmp, "comercial.mp4");
        const other = path.join(tmp, "private.txt");
        fs.writeFileSync(video, Buffer.from("0123456789abcdef"));
        fs.writeFileSync(other, "not public");
        const handler = createMediaProtocolHandler(() => [{path:video}]);
        const req = (filename, method="GET", range) => ({
            method,
            url:mediaUrl(filename),
            headers:new Headers(range ? {"range":range} : {})
        });
        assert.equal(decodeMediaUrl(mediaUrl(video)), video);
        const full = handler(req(video));
        assert.equal(full.status, 200);
        assert.equal(full.headers.get("content-length"), "16");
        assert.equal(await full.text(), "0123456789abcdef");
        const sliced = handler(req(video, "GET", "bytes=3-7"));
        assert.equal(sliced.status,206);
        assert.equal(sliced.headers.get("content-range"),"bytes 3-7/16");
        assert.equal(await sliced.text(), "34567");
        const suffix = handler(req(video,"GET","bytes=-3"));
        assert.equal(await suffix.text(),"def");
        const head = handler(req(video,"HEAD"));
        assert.equal(head.status,200);
        assert.equal(await head.text(),"");
        const invalid = handler(req(video,"GET","bytes=99-100"));
        assert.equal(invalid.status,416);
        assert.equal(handler(req(other)).status,403);
        assert.equal(handler({method:"GET",url:"santtos-media://media/%2E%2E",headers:new Headers()}).status,403);
        assert.equal(handler({method:"POST",url:mediaUrl(video),headers:new Headers()}).status,403);
    } finally {
        fs.rmSync(tmp,{recursive:true,force:true});
    }
});

test("Renderer uses secure media scheme and enforces CSP", () => {
    const root=path.resolve(__dirname,"..");
    const main=fs.readFileSync(path.join(root,"src/main/main.js"),"utf8");
    const app=fs.readFileSync(path.join(root,"src/renderer/src/App.tsx"),"utf8");
    const preload=fs.readFileSync(path.join(root,"src/main/preload.js"),"utf8");
    const html=fs.readFileSync(path.join(root,"src/renderer/index.html"),"utf8");
    assert(main.includes("webSecurity: true"));
    assert(main.includes("sandbox: true"));
    assert(main.includes("protocol.registerSchemesAsPrivileged"));
    assert(main.includes("protocol.handle(MEDIA_SCHEME"));
    assert(!app.includes("file:///"));
    assert(app.includes("window.santtosAPI.getMediaFileUrl(selectedMedia.path)"));
    assert(preload.includes("santtos-media://media/"));
    assert(html.includes("Content-Security-Policy"));
    assert(html.includes("frame-src 'none'"));
    assert(html.includes("object-src 'none'"));
});

test("Byte range handles invalid values and zero-length content", () => {
    assert.deepEqual(parseRange("bytes=0-4",10),{start:0,end:4});
    assert.deepEqual(parseRange("bytes=5-",10),{start:5,end:9});
    assert.deepEqual(parseRange("bytes=-50",10),{start:0,end:9});
    assert.equal(parseRange("bytes=30-40",10),null);
    assert.equal(parseRange("bytes=0-1,4-8",10),null);
    assert.equal(parseRange("bytes=-0",10),null);
});
