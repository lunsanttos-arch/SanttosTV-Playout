"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildMediaUrl, parseByteRange, serveImportedVideo } =
    require("../src/core/media/media-protocol");

async function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "santtos-preview-"));
    try {
        const filePath = path.join(root, "filme-com-acento-ç.mp4");
        const privatePath = path.join(root, "private.mp4");
        const bytes = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz", "utf8");
        fs.writeFileSync(filePath, bytes);
        fs.writeFileSync(privatePath, bytes);
        const library = [{ id: "media1", path: filePath }];
        const url = buildMediaUrl(filePath);

        async function read(range, method = "GET", urlToFetch = url) {
            const request = new Request(urlToFetch, {
                method,
                headers: range ? { Range: range } : undefined
            });
            const response = serveImportedVideo(request, library);
            const body = method === "HEAD" ? null : Buffer.from(await response.arrayBuffer());
            return { response, body };
        }

        const full = await read(null);
        assert.equal(full.response.status, 200);
        assert.equal(full.response.headers.get("accept-ranges"), "bytes");
        assert.equal(full.response.headers.get("content-type"), "video/mp4");
        assert.equal(full.response.headers.get("content-length"), String(bytes.length));
        assert.deepEqual(full.body, bytes);

        const partial = await read("bytes=5-9");
        assert.equal(partial.response.status, 206);
        assert.equal(partial.response.headers.get("content-range"),
            `bytes 5-9/${bytes.length}`);
        assert.equal(partial.body.toString(), "56789");

        const suffix = await read("bytes=-4");
        assert.equal(suffix.response.status, 206);
        assert.equal(suffix.body.toString(), "wxyz");

        const open = await read("bytes=30-");
        assert.equal(open.response.status, 206);
        assert.equal(open.body.toString(), "uvwxyz");

        const head = await read("bytes=0-3", "HEAD");
        assert.equal(head.response.status, 206);
        assert.equal(head.response.headers.get("content-length"), "4");
        assert.equal(head.body, null);

        for (const invalid of ["bytes=999-1000", "bytes=5-1",
            "bytes=0-1,2-3", "garbage", "bytes=-0"]) {
            const outcome = await read(invalid);
            assert.equal(outcome.response.status, 416, invalid);
            assert.equal(outcome.response.headers.get("content-range"),
                `bytes */${bytes.length}`);
        }
        assert.equal(parseByteRange("bytes=0-0", bytes.length).end, 0);
        const forbidden = await read(null, "GET", buildMediaUrl(privatePath));
        assert.equal(forbidden.response.status, 404);
        assert.equal(forbidden.body.toString(), "Midia nao autorizada ou ausente");
        console.log("MEDIA STREAM QA: APROVADO — Range, seek, HEAD e isolamento.");
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error("MEDIA STREAM QA: REPROVADO", error);
    process.exitCode = 1;
});
