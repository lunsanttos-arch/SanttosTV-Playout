"use strict";
const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
function clock(seconds) {
    if (seconds === null) return "—";
    const total = Math.floor(seconds), days = Math.floor(total / 86400);
    return [Math.floor(total / 3600) % 24, Math.floor(total / 60) % 60, total % 60].map(value => String(value).padStart(2, "0")).join(":") + (days ? ` (+${days} dia${days > 1 ? "s" : ""})` : "");
}
function durationClock(seconds) {
    if (seconds === null) return "—";
    const total = Math.floor(seconds);
    return [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60].map(value => String(value).padStart(2, "0")).join(":");
}
function rundownPrintHtml(rundown) {
    if (!rundown || !Array.isArray(rundown.items) || rundown.items.length > 10000 || !/^\d{4}-\d{2}-\d{2}$/.test(rundown.date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(rundown.startTime)) throw Error("Roteiro inválido para PDF.");
    const [hours, minutes] = rundown.startTime.split(":").map(Number);
    let next = hours * 3600 + minutes * 60, total = 0;
    const rows = rundown.items.map(item => {
        const start = next;
        const input = Math.max(0, Number(item.inPoint) || 0);
        const duration = item.duration === null || item.duration === undefined ? null : Number(item.duration);
        const requestedOut = Number(item.outPoint) > 0 ? Number(item.outPoint) : duration;
        const out = Number.isFinite(duration) && duration > 0 ? Math.min(duration, requestedOut) : requestedOut;
        const length = Number.isFinite(out) && out > input ? out - input : null;
        if (next !== null) next = length === null ? null : next + length;
        if (total !== null) total = length === null ? null : total + length;
        const state = item.liveSlot ? "Ao vivo · avanço manual" : item.placeholder ? "Conteúdo a definir" : "";
        const kind = item.liveSlot ? "live" : item.placeholder ? "pending" : item.notes ? "marked" : "";
        return `<tr class="${kind}"><td class="time">${clock(start)}</td><td class="number">${escape(item.blockLabel)}</td><td class="material"><strong>${escape(item.name || (item.liveSlot ? "Ao Vivo" : "Conteúdo a definir"))}</strong>${state ? `<small class="badge">${state}</small>` : ""}</td><td class="time duration">${durationClock(length)}</td><td class="notes">${escape(item.notes)}</td></tr>`;

    }).join("");
    const date = rundown.date.split("-").reverse().join("/");
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Roteiro ${date}</title><style>
        :root{color-scheme:light}*{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#24222b;background:#f1eff5;margin:0;padding:32px 20px}.sheet{max-width:1100px;margin:auto;background:#fff;padding:32px 36px;border-radius:12px;box-shadow:0 8px 40px #33225112}.masthead{display:flex;justify-content:space-between;gap:16px;align-items:center}.brand{font-size:23px;font-weight:800;letter-spacing:-1px;color:#7447c8}.brand small{display:block;font-size:9px;letter-spacing:2px;margin-top:5px;color:#77717e}.document-kind{font-size:10px;font-weight:bold;letter-spacing:2px;color:#7447c8;text-align:right}h1{font-size:21px;line-height:1.25;margin:20px 0 16px}.meta{display:grid;grid-template-columns:1.2fr 1fr 1fr 1fr;gap:12px;border-top:2px solid #7447c8;padding:14px 0 18px}.meta span{display:block;font-size:9px;letter-spacing:1px;color:#797381;margin-bottom:5px}.meta strong{font-size:13px}.caption{font-size:10px;color:#77717e;margin:0 0 12px}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;table-layout:fixed}thead{display:table-header-group}th{text-align:left;background:#f1edf8;color:#514365;letter-spacing:.6px;text-transform:uppercase;font-size:9px;padding:9px 6px;border-top:1px solid #d6cce6;border-bottom:1px solid #d6cce6}td{padding:6px;border-bottom:1px solid #e1dee7;overflow-wrap:anywhere;vertical-align:top;line-height:1.35}tr{break-inside:avoid}tbody tr:nth-child(even){background:#faf9fc}tr.marked{background:#f0edf5!important}tr.marked .material{border-left:3px solid #a398b5}tr.live{background:#f0eafa!important}tr.live .material{border-left:3px solid #7447c8}tr.pending{background:#fff3f3!important}tr.pending .material{border-left:3px solid #bd4545}.time,.number{font-variant-numeric:tabular-nums;font-size:10px}.time{white-space:nowrap;font-weight:bold}.number{font-weight:bold}.duration{text-align:center}.material{font-size:11px}.notes{white-space:pre-wrap;font-size:10px}.badge{display:block;color:#7447c8;font-size:8px;text-transform:uppercase;letter-spacing:.5px;margin-top:3px}.pending .badge{color:#aa3030}.endnote{margin:14px 0 0;font-size:9px;color:#8b8592}
        @media(max-width:750px){body{padding:12px}.sheet{padding:20px 16px}.meta{grid-template-columns:1fr 1fr}table{min-width:720px}}
        @page{size:A4;margin:12mm 10mm 15mm}
        @media print{body{padding:0;background:white;font-size:10px}.sheet{padding:0;max-width:none;box-shadow:none;border-radius:0}.brand{font-size:20px}h1{font-size:17px;margin:14px 0 12px}.meta{grid-template-columns:1.2fr 1fr 1fr 1fr;padding:10px 0 12px;gap:8px}.meta strong{font-size:11px}.table-wrap{overflow:visible}table{min-width:0}td{padding:4px 5px;line-height:1.3}.material{font-size:9px}.time,.number,.notes{font-size:8px}th{padding:7px 5px;font-size:8px}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
        </style></head><body><main class="sheet"><header><div class="masthead"><div class="brand">SanTTos<small>BROADCAST SUITE</small></div><div class="document-kind">ROTEIRO<br>DE PROGRAMAÇÃO</div></div><h1>${escape(rundown.title || "Programação diária")}</h1><div class="meta"><div><span>DIA</span><strong>${date}</strong></div><div><span>ABERTURA</span><strong>${rundown.startTime}:00</strong></div><div><span>TÉRMINO PREVISTO</span><strong>${clock(next)}</strong></div><div><span>ITENS / DURAÇÃO</span><strong>${rundown.items.length} / ${durationClock(total)}</strong></div></div></header><p class="caption">Horários programados · Número corresponde à identificação informada no roteiro.</p><div class="table-wrap"><table><colgroup><col style="width:12%"><col style="width:12%"><col style="width:37%"><col style="width:13%"><col style="width:26%"></colgroup><thead><tr><th>Hora</th><th>Número</th><th>Material</th><th>Duração</th><th>Observação</th></tr></thead><tbody>${rows}</tbody></table></div><p class="endnote">Conteúdos a definir e entradas ao vivo permanecem identificados. O horário real pode variar durante a operação.</p></main></body></html>`;

}
async function renderRundownPdf(BrowserWindow, rundown) {
    const html = rundownPrintHtml(rundown);
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    try {
        await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        return await window.webContents.printToPDF({ pageSize: "A4", preferCSSPageSize: true, printBackground: true, margins: { top: 0.4, bottom: 0.6, left: 0.35, right: 0.35 },
            displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: '<div style="font:9px Arial;width:100%;text-align:center">SanTTos · <span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
    } finally { window.destroy(); }
}
module.exports = { rundownPrintHtml, renderRundownPdf };
