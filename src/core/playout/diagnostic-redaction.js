"use strict";
// Diagnostics may be shared with support. Keep paths and transport status useful,
// but never export URL credentials, queries or application secrets.
function redactDiagnostic(value, key = "") {
    if (/password|passphrase|token|secret|authorization|cookie|api[-_]?key|sessionpin|controllerpin/i.test(key)) return "[oculto]";
    if (Array.isArray(value)) return value.map(item => redactDiagnostic(item));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactDiagnostic(item, name)]));
    if (typeof value !== "string") return value;
    return value.replace(/\b(Authorization|Cookie|X-API-Key)\s*[:=]\s*[^\r\n]+/gi, "$1: [oculto]")
    .replace(/(?:https?|rtmps?|srt):\/\/[^\s<>"']+/gi, raw => {
        try { const url = new URL(raw); url.username = ""; url.password = ""; url.search = ""; url.hash = ""; return url.origin === "null" ? `${url.protocol}//${url.host}/[oculto]` : `${url.origin}/[oculto]`; }
        catch { return "[URL oculta]"; }
    });
}
module.exports = { redactDiagnostic };
