"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ExcelJS = require("exceljs");
const reports = require("../src/core/reporting/playout-report");

(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "santtos-readable-report-"));
    try {
        reports.initializePlayoutReports({ userDataPath: root, documentsPath: root });
        const entry = reports.startPlayoutEntry({ id: "media-1", name: "Filme <teste>", path: "C:\\Filme.mp4", duration: 60 });
        reports.finishPlayoutEntry(entry.id, "EXECUTADO", 15);
        const files = await reports.listReportFiles();
        assert.equal(files.length, 1);
        const htmlPath = path.join(reports.getReportFolder(), files[0].name);
        const html = fs.readFileSync(htmlPath, "utf8");
        assert(html.includes("<table>") && html.includes("EXECUTADO"));
        assert(html.includes("&lt;teste&gt;"), "Names must remain escaped in readable reports");
        const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(htmlPath.replace(/\.html$/, ".xlsx"));
        assert.equal(workbook.worksheets[0].rowCount, 2);
        assert.equal(workbook.worksheets[0].getRow(2).getCell(8).value, "EXECUTADO");
        assert.equal(workbook.worksheets[0].getRow(2).getCell(9).value, "C:\\Filme.mp4");
        assert(fs.existsSync(htmlPath.replace(/\.html$/, ".xml")));
        console.log("REPORT QA: APROVADO — HTML legível, XLSX válido e compatibilidade XML.");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
