"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { buildMediaUrl, serveImportedVideo } = require('../media/media-protocol');

class SchedulingWebController {
    constructor({ distFolder, getMedia, getRundown, saveRundown, getCategories = () => [], getWeekly, saveWeekly, renderPdf, resolveWatchSource, commit = async () => {}, port = 8787 }) {
        Object.assign(this, { distFolder, getMedia, getRundown, saveRundown, getCategories, getWeekly, saveWeekly, renderPdf, resolveWatchSource, commit, port });
        this.server = null; this.sessions = new Map(); this.attempts = new Map();
        this.pin = "";
    }
    status() {
        const addresses = Object.values(os.networkInterfaces()).flat().filter(address => address?.family === "IPv4" && !address.internal)
            .map(address => `http://${address.address}:${this.port}/controller`);
        return { enabled: Boolean(this.server), port: this.port, addresses, pin: this.server ? this.pin : "" };
    }
    async start() {
        if (this.server) return this.status();
        this.pin = String(crypto.randomInt(100000, 1000000));
        const server = http.createServer((req, res) => { this.handle(req, res).catch(() => {
            if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Não foi possível concluir a operação." }));
        }); });
        await new Promise((resolve, reject) => { server.once("error", reject); server.listen(this.port, "0.0.0.0", resolve); });
        this.server = server;
        this.port = server.address().port;
        return this.status();
    }
    async body(req) {
        let body = "";
        for await (const chunk of req) {
            body += chunk;
            if (Buffer.byteLength(body) > 1024 * 1024) throw new Error("Programação muito grande.");
        }
        return JSON.parse(body || "{}");
    }
    async handle(req, res) {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'");
        const parsed = new URL(req.url, "http://127.0.0.1");
        const send = (code, data) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
        const origin = req.headers.origin;
        if (origin && origin !== `http://${req.headers.host}`) return send(403, { error: "Origem não autorizada." });
        if (parsed.pathname === "/api/login" && req.method === "POST") {
            const address = req.socket.remoteAddress;
            const limit = this.attempts.get(address) || { count: 0, since: Date.now() };
            if (Date.now() - limit.since > 60000) { limit.count = 0; limit.since = Date.now(); }
            this.attempts.set(address, limit);
            if (++limit.count > 10) return send(429, { error: "Aguarde um minuto para tentar novamente." });
            const input = String((await this.body(req)).pin || "");
            if (!/^\d{6}$/.test(input) || !crypto.timingSafeEqual(Buffer.from(input), Buffer.from(this.pin))) {
                return send(401, { error: "Código de acesso inválido." });
            }
            const session = crypto.randomBytes(32).toString("hex");
            if (this.sessions.size >= 128) this.sessions.delete(this.sessions.keys().next().value);
            this.sessions.set(session, Date.now() + 28800000);
            res.setHeader("Set-Cookie", `santtos_controller=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
            return send(200, { ok: true });
        }
        if (parsed.pathname.startsWith("/api/")) {
            const session = req.headers.cookie?.match(/(?:^|;\s*)santtos_controller=([a-f0-9]+)/)?.[1];
            if (!session || (this.sessions.get(session) || 0) < Date.now()) {
                this.sessions.delete(session);
                return send(401, { error: "Informe o código de acesso do master." });
            }
            if (['GET', 'HEAD'].includes(req.method) && parsed.pathname === '/api/media/watch') {
                const id = parsed.searchParams.get('id');
                if (!id || id.length > 240) return send(404, {error:'Material não cadastrado.'});
                const controller = new AbortController();
                const abort = () => controller.abort();
                res.once('close', abort);
                try {
                    let file;
                    // The master resolver validates the library ID itself, avoiding
                    // an entire catalog IPC round-trip for every browser seek.
                    if (this.resolveWatchSource) file = await this.resolveWatchSource(id);
                    else {
                        const item = (await this.getMedia()).find(media => media.id === id && !media.placeholder && media.sourceType !== 'input');
                        if (!item) return send(404, {error:'Material não cadastrado.'});
                        file = item.path;
                    }
                    if (controller.signal.aborted) return;
                    const response = serveImportedVideo(new Request(buildMediaUrl(file), {
                        method:req.method, headers:req.headers.range ? {Range:req.headers.range} : {}, signal:controller.signal
                    }), [{path:file}]);
                    const headers = Object.fromEntries(response.headers);
                    headers['Content-Disposition'] = 'inline';
                    res.writeHead(response.status, headers);
                    if (!response.body) res.end();
                    else await pipeline(Readable.fromWeb(response.body), res);
                } catch {
                    if (!res.headersSent) send(404, {error:'Arquivo indisponível para reprodução.'});
                    else res.destroy();
                } finally { res.off('close', abort); }
                return;
            }
            if (req.method === "GET" && parsed.pathname === "/api/weekly" && this.getWeekly) {
                try { return send(200, await this.getWeekly(Number(parsed.searchParams.get("weekday")))); }
                catch (error) { return send(400, { error: error.message }); }
            }
            if (req.method === "POST" && parsed.pathname === "/api/weekly" && this.saveWeekly) {
                try { const body = await this.body(req); await this.commit({ retry: true }); const rundown = await this.saveWeekly(body.weekday, body.rundown); await this.commit(); return send(200, { ok: true, rundown }); }
                catch (error) { return send(400, { error: error.message }); }
            }
            if (req.method === "POST" && parsed.pathname === "/api/rundown/html") {
                try {
                    const html = require("./rundown-pdf").rundownPrintHtml(await this.body(req));
                    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": 'attachment; filename="roteiro-santtos.html"' }); res.end(html); return;
                } catch (error) { return send(400, { error: error.message }); }
            }
            if (req.method === "POST" && parsed.pathname === "/api/rundown/pdf" && this.renderPdf) {
                if (this.pdfBusy) return send(409, { error: "Um PDF está sendo gerado. Aguarde." });
                this.pdfBusy = true;
                try {
                    const pdf = await this.renderPdf(await this.body(req));
                    res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="roteiro-santtos.pdf"' });
                    res.end(pdf); return;
                } catch (error) { return send(400, { error: error.message }); }
                finally { this.pdfBusy = false; }
            }
            if (req.method === "GET" && parsed.pathname === "/api/media") return send(200, await this.getMedia());
            if (req.method === "GET" && parsed.pathname === "/api/library-categories") return send(200, await this.getCategories());
            if (req.method === "GET" && parsed.pathname === "/api/rundown") return send(200, await this.getRundown(parsed.searchParams.get("date")));
            if (req.method === "POST" && parsed.pathname === "/api/rundown") {
                try { const body = await this.body(req); await this.commit({ retry: true }); const rundown = await this.saveRundown(body); await this.commit(); return send(200, { ok: true, rundown }); }
                catch (error) { return send(400, { ok: false, error: error.message }); }
            }
            return send(404, { error: "Operação indisponível." });
        }
        if (req.method !== "GET") return send(405, { error: "Método indisponível." });
        const relative = parsed.pathname === "/controller" || parsed.pathname === "/" ? "controller.html" : parsed.pathname.slice(1);
        if (relative !== "controller.html" && !/^assets\/[A-Za-z0-9_.-]+\.(js|css|woff2|svg|png|webp)$/.test(relative)) return send(404, { error: "Arquivo indisponível." });
        const file = path.join(this.distFolder, relative);
        if (!fs.existsSync(file)) return send(503, { error: "Interface remota não compilada. Execute npm run build:renderer." });
        const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" }[path.extname(file)] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": mime + "; charset=utf-8" });
        fs.createReadStream(file).pipe(res);
    }
    stop() {
        this.server?.close(); this.server?.closeAllConnections(); this.server = null;
        this.sessions.clear(); this.pin = "";
    }
}
module.exports = { SchedulingWebController };
