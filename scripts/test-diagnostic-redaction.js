const assert = require("node:assert/strict");
const { redactDiagnostic } = require("../src/core/playout/diagnostic-redaction");
const diagnostic = redactDiagnostic({ engine: { filePath: "https://user:password@example.com/live/private.m3u8?token=private#private" },
    error: "Decoder rtmp://user:password@localhost/live/private closed", passphrase: "private", nested: [{ token: "private", cookie: "private", api_key: "private" }],
    headers: "Authorization: Bearer private\r\nCookie: private\r\nX-API-Key: private", state: "PLAYING" });
assert(!JSON.stringify(diagnostic).includes("private"));
assert(!JSON.stringify(diagnostic).includes("password@example"));
assert.equal(diagnostic.state, "PLAYING");
assert(diagnostic.engine.filePath.includes("example.com"));
console.log("DIAGNOSTICS: URLs and nested credentials redacted; operational state preserved");
