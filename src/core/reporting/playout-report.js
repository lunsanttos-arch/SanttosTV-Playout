const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {contentLabel} = require("../media/content-label.mjs");

let stateFile = "";
let configFile = "";
let defaultReportFolder = "";
let reportFolder = "";
let state = { entries: [] };
let writeQueue = Promise.resolve();

function ensureFolder(folderPath) {
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
    }
}

function readConfig() {
    if (!configFile || !fs.existsSync(configFile)) {
        return {};
    }

    try {
        const parsed = JSON.parse(
            fs.readFileSync(configFile, "utf8")
        );
        return parsed && typeof parsed === "object"
            ? parsed
            : {};
    } catch (error) {
        console.warn(
            "Não foi possível carregar a configuração de relatórios:",
            error
        );
        return {};
    }
}

function saveConfig() {
    ensureFolder(path.dirname(configFile));
    const temporary =
        `${configFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
        fs.writeFileSync(
            temporary,
            JSON.stringify(
                { reportFolder },
                null,
                2
            ),
            "utf8"
        );
        if (fs.existsSync(configFile)) {
            fs.copyFileSync(
                configFile,
                `${configFile}.bak`
            );
        }
        fs.renameSync(temporary, configFile);
    } finally {
        if (fs.existsSync(temporary)) {
            fs.rmSync(temporary, { force: true });
        }
    }
}

function initializePlayoutReports({
    userDataPath,
    documentsPath
}) {
    const stateFolder = path.join(
        userDataPath,
        "reporting"
    );

    defaultReportFolder = path.join(
        documentsPath,
        "Santtos TV",
        "Relatórios de Exibição"
    );
    stateFile = path.join(
        stateFolder,
        "playout-report-state.json"
    );
    configFile = path.join(
        stateFolder,
        "playout-report-config.json"
    );

    ensureFolder(stateFolder);

    const config = readConfig();
    reportFolder =
        typeof config.reportFolder === "string" &&
        config.reportFolder.trim()
            ? config.reportFolder.trim()
            : defaultReportFolder;

    try {
        ensureFolder(reportFolder);
        if (!fs.statSync(reportFolder).isDirectory()) throw Error("O destino dos relatórios não é uma pasta.");
    } catch (error) {
        if (reportFolder === defaultReportFolder) throw error;
        console.warn("Pasta configurada dos relatórios indisponível; usando a pasta padrão:", error.message);
        reportFolder = defaultReportFolder;
        ensureFolder(reportFolder);
    }

    state = { entries: [] };

    try {
        if (fs.existsSync(stateFile)) {
            const parsed = JSON.parse(
                fs.readFileSync(
                    stateFile,
                    "utf8"
                )
            );
            if (!Array.isArray(parsed?.entries)) {
                throw new Error(
                    "Histórico de exibição com estrutura inválida."
                );
            }
            state.entries = parsed.entries;
        }
    } catch (error) {
        console.error(
            "Não foi possível carregar o histórico de exibição:",
            error
        );
        try {
            fs.copyFileSync(
                stateFile,
                `${stateFile}.corrompido-${Date.now()}`
            );
        } catch (copyError) {
            console.error(
                "Falha ao preservar histórico danificado:",
                copyError
            );
        }
        throw new Error(
            "Histórico de exibição danificado. Original preservado em " +
            stateFile
        );
    }

    const recoveredAt =
        new Date().toISOString();
    let recovered = false;
    const recoveredDates = new Set();

    for (const entry of state.entries) {
        if (
            entry.status !==
            "EM_EXIBICAO"
        ) {
            continue;
        }

        entry.status = "PULADO_POR_ERRO";
        entry.errorReason = "Execução interrompida por encerramento inesperado do aplicativo ou reinício do computador.";
        entry.endedAt = recoveredAt;
        entry.playedSeconds = 0;
        entry.playedSecondsUnknown = true;
        entry.errorReason += " Tempo parcial exibido não recuperado.";
        entry.recoveredAfterCrash = true;
        recoveredDates.add(entry.reportDate);
        recovered = true;
    }

    if (recovered) {
        saveState();
    }

    const reportDates = new Map();

    for (const entry of state.entries) {
        if (
            (
                entry.status !== "EXECUTADO" &&
                !["PULADO", "PULADO_POR_ERRO"].includes(entry.status)
            ) ||
            typeof entry.reportDate !== "string" ||
            !/^\d{4}-\d{2}-\d{2}$/.test(
                entry.reportDate
            )
        ) {
            continue;
        }

        const lastChange =
            Date.parse(
                entry.endedAt ||
                entry.startedAt
            ) || 0;

        reportDates.set(
            entry.reportDate,
            Math.max(
                reportDates.get(
                    entry.reportDate
                ) || 0,
                lastChange
            )
        );
    }

    for (
        const [dateKey, lastChange]
        of reportDates
    ) {
        const outputFile = path.join(
            reportFolder,
            `Relatorio_Exibicao_${dateKey}.xml`
        );
        let needsExport = true;

        try {
            needsExport =
                recoveredDates.has(dateKey) ||
                !fs.existsSync(outputFile) || !fs.existsSync(outputFile.replace(/\.xml$/, ".html")) ||
                fs.statSync(outputFile)
                    .mtimeMs +
                    1000 <
                    lastChange;
        } catch (error) {
            console.warn(
                "Não foi possível verificar o relatório XML:",
                error
            );
        }

        if (needsExport) {
            queueExport(dateKey);
        }
    }

    return {
        reportFolder,
        stateFile
    };
}

function saveState() {
    if (!stateFile) {
        throw new Error(
            "Relatórios de exibição ainda não foram inicializados."
        );
    }

    ensureFolder(
        path.dirname(stateFile)
    );

    const temporary =
        `${stateFile}.${process.pid}.${crypto.randomUUID()}.tmp`;

    let handle;

    try {
        handle = fs.openSync(
            temporary,
            "wx"
        );
        fs.writeFileSync(
            handle,
            JSON.stringify(
                state,
                null,
                2
            ),
            "utf8"
        );
        fs.fsyncSync(handle);
        fs.closeSync(handle);
        handle = undefined;

        if (fs.existsSync(stateFile)) {
            fs.copyFileSync(
                stateFile,
                `${stateFile}.bak`
            );
        }

        fs.renameSync(
            temporary,
            stateFile
        );
    } finally {
        if (handle !== undefined) {
            fs.closeSync(handle);
        }

        if (fs.existsSync(temporary)) {
            fs.rmSync(
                temporary,
                { force: true }
            );
        }
    }
}

function pad(value) {
    return String(value)
        .padStart(2, "0");
}

function localDateKey(value) {
    const date =
        value instanceof Date
            ? value
            : new Date(value);

    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate())
    ].join("-");
}

function localDateLabel(value) {
    const date =
        value instanceof Date
            ? value
            : new Date(value);

    return [
        pad(date.getDate()),
        pad(date.getMonth() + 1),
        date.getFullYear()
    ].join("/");
}

function localTimeLabel(value) {
    const date =
        value instanceof Date
            ? value
            : new Date(value);

    return [
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds())
    ].join(":");
}

function formatDuration(seconds) {
    const total = Math.max(
        0,
        Math.floor(
            Number(seconds) || 0
        )
    );
    const hours =
        Math.floor(total / 3600);
    const minutes =
        Math.floor(
            (total % 3600) / 60
        );
    const secs =
        total % 60;

    return [
        hours,
        minutes,
        secs
    ]
        .map(pad)
        .join(":");
}

function sanitizeText(
    value,
    maxLength = 4096
) {
    return typeof value === "string"
        ? value
            .trim()
            .slice(0, maxLength)
        : "";
}

function sanitizeNumber(
    value,
    fallback = 0
) {
    const parsed =
        Number(value);

    return Number.isFinite(parsed)
        ? Math.max(0, parsed)
        : fallback;
}

function xmlEscape(value) {
    return String(
        value ?? ""
    )
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}

function xmlTag(name, value, indent = "    ") {
    return (
        indent +
        "<" +
        name +
        ">" +
        xmlEscape(value) +
        "</" +
        name +
        ">"
    );
}

async function exportDate(dateKey) {
    const destination = reportFolder;
    if (!destination) {
        return;
    }

    const rows =
        state.entries
            .filter(
                (entry) =>
                    entry.reportDate ===
                        dateKey &&
                    (
                        entry.status ===
                            "EXECUTADO" ||
                        ["PULADO", "PULADO_POR_ERRO"].includes(entry.status)
                    )
            )
            .sort(
                (left, right) =>
                    new Date(
                        left.startedAt
                    ).getTime() -
                    new Date(
                        right.startedAt
                    ).getTime()
            );

    if (!rows.length) return;
    const { Worker } = require("node:worker_threads");
    return new Promise((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, "report-export-worker.js"), { workerData: { dateKey, destination, rows } });
        let settled = false;
        const timeout = setTimeout(() => { if (!settled) { settled = true; void worker.terminate(); reject(Error("Exportação de relatório excedeu 60 segundos.")); } }, 60000);
        worker.once("message", result => { settled = true; clearTimeout(timeout); result.error ? reject(Error(result.error)) : resolve(result.filePath); });
        worker.once("error", error => { settled = true; clearTimeout(timeout); reject(error); });
        worker.once("exit", code => { if (!settled) { settled = true; clearTimeout(timeout); reject(Error(`Exportador terminou sem resultado (${code}).`)); } });
    });
}

async function writeReportSnapshot({ dateKey, destination, rows }) {
    if (rows.length === 0) {
        return;
    }

    ensureFolder(destination);

    const headers = ["Data", "Código", "Nome", "Bloco", "Entrada", "Saída", "Previsto", "Exibido", "Status", "Caminho", "Motivo", "Conteúdo seguinte", "Contingência"];
    const values = rows.map(entry => [localDateLabel(entry.startedAt), contentLabel(entry).code, contentLabel(entry).name, entry.blockLabel || "",
        localTimeLabel(entry.startedAt), entry.endedAt ? localTimeLabel(entry.endedAt) : "",
        formatDuration(entry.plannedDurationSeconds), entry.playedSecondsUnknown ? "Não recuperado" : formatDuration(entry.playedSeconds), entry.status.replaceAll("_", " "), entry.filePath || "", entry.errorReason || "", entry.nextContent || "", entry.contingencyContent || ""]);
    const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Relatório ${xmlEscape(dateKey)}</title>
        <style>body{font:14px Arial;background:#14141e;color:#eee;padding:24px}h1{color:#a78bfa}
        table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #353544}th{background:#292339}
        @media print{body{background:white;color:black}h1{color:black}}</style>
        <h1>SanTTos · Relatório de exibição</h1><p>${xmlEscape(dateKey)}</p><table><thead><tr>
        ${headers.map(value => `<th>${xmlEscape(value)}</th>`).join("")}</tr></thead><tbody>
        ${values.map(row => `<tr>${row.map(value => `<td>${xmlEscape(value)}</td>`).join("")}</tr>`).join("")}</tbody></table></html>`;
    const humanFile = path.join(destination, `Relatorio_Exibicao_${dateKey}.html`);
    const humanTemp = humanFile + ".tmp";
    fs.writeFileSync(humanTemp, html, "utf8");
    fs.renameSync(humanTemp, humanFile);
    const ExcelJS = require("exceljs");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Exibição");
    sheet.addRow(headers); sheet.addRows(values);
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6D28D9" } };
    sheet.columns.forEach(column => { column.width = 24; });
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    const excelFile = humanFile.replace(/\.html$/, ".xlsx");
    const excelTemp = excelFile + ".tmp";
    await workbook.xlsx.writeFile(excelTemp);
    try { fs.renameSync(excelTemp, excelFile); }
    catch (error) {
        // Excel locks an open workbook on Windows; preserve the fresh export.
        if (["EBUSY", "EPERM", "EACCES"].includes(error.code)) fs.renameSync(excelTemp, excelFile.replace(/\.xlsx$/, "_Atualizado.xlsx"));
        else throw error;
    }

    const body =
        rows.map((entry) => [
            "  <exibicao>",
            xmlTag(
                "data",
                localDateLabel(
                    entry.startedAt
                )
            ),
            xmlTag(
                "arquivo",
                entry.fileName
            ),
            xmlTag("codigo", contentLabel(entry).code),
            xmlTag("nome", contentLabel(entry).name),
            xmlTag(
                "bloco",
                entry.blockLabel || ""
            ),
            xmlTag(
                "entrada",
                localTimeLabel(
                    entry.startedAt
                )
            ),
            xmlTag(
                "saida",
                entry.endedAt
                    ? localTimeLabel(
                          entry.endedAt
                      )
                    : ""
            ),
            xmlTag(
                "duracao_prevista",
                formatDuration(
                    entry.plannedDurationSeconds
                )
            ),
            xmlTag(
                "duracao_exibida",
                formatDuration(
                    entry.playedSeconds
                )
            ),
            xmlTag(
                "status",
                entry.status
            ),
            xmlTag("duracao_exibida_conhecida", entry.playedSecondsUnknown ? "false" : "true"),
            xmlTag("motivo", entry.errorReason || ""),
            xmlTag("conteudo_seguinte", entry.nextContent || ""),
            xmlTag("contingencia", entry.contingencyContent || ""),
            xmlTag(
                "caminho",
                entry.filePath
            ),
            "  </exibicao>"
        ].join("\n"))
            .join("\n");

    const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<relatorio_exibicao data="${xmlEscape(dateKey)}" gerado_por="Santtos Playout">`,
        body,
        "</relatorio_exibicao>",
        ""
    ].join("\n");

    const filePath =
        path.join(
            destination,
            `Relatorio_Exibicao_${dateKey}.xml`
        );

    const temporaryFile =
        `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;

    try {
        fs.writeFileSync(
            temporaryFile,
            xml,
            "utf8"
        );
        fs.renameSync(
            temporaryFile,
            filePath
        );
        return filePath;
    } finally {
        if (
            fs.existsSync(
                temporaryFile
            )
        ) {
            fs.rmSync(
                temporaryFile,
                { force: true }
            );
        }
    }
}

const pendingExports = new Set();
function queueExport(dateKey) {
    // Several errors/successor updates in the same turn need one fresh export.
    pendingExports.add(dateKey);
    if (!exportScheduled) {
        exportScheduled = true;
        writeQueue = writeQueue.then(async () => {
            while (pendingExports.size) {
                const date = pendingExports.values().next().value;
                pendingExports.delete(date);
                try { await exportDate(date); }
                catch (error) { console.error("Falha ao atualizar relatório:", error); }
            }
        }).finally(() => { exportScheduled = false; });
    }
    return writeQueue;
}
let exportScheduled = false;

function reexportAllDates() {
    const dates =
        new Set(
            state.entries
                .filter(
                    (entry) =>
                        entry.reportDate &&
                        (
                            entry.status ===
                                "EXECUTADO" ||
                            ["PULADO", "PULADO_POR_ERRO"].includes(entry.status)
                        )
                )
                .map(
                    (entry) =>
                        entry.reportDate
                )
        );

    for (
        const dateKey
        of dates
    ) {
        queueExport(dateKey);
    }
}

function setReportFolder(folderPath) {
    if (
        typeof folderPath !==
            "string" ||
        !folderPath.trim()
    ) {
        throw new Error(
            "Pasta de relatórios inválida."
        );
    }

    const normalized =
        path.resolve(
            folderPath.trim()
        );

    ensureFolder(normalized);
    reportFolder = normalized;
    saveConfig();
    reexportAllDates();

    return reportFolder;
}

function resetReportFolder() {
    reportFolder =
        defaultReportFolder;
    ensureFolder(reportFolder);
    saveConfig();
    reexportAllDates();

    return reportFolder;
}

function startPlayoutEntry(media) {
    const startedAt =
        new Date();

    const entry = {
        id:
            crypto.randomUUID(),
        occurrenceId:
            sanitizeText(
                media?.id,
                240
            ),
        sourceMediaId:
            sanitizeText(
                media?.sourceMediaId,
                240
            ),
        fileName:
            sanitizeText(
                media?.name,
                512
            ) ||
            path.basename(
                sanitizeText(
                    media?.path
                )
            ),
        contentCode: contentLabel(media).code,
        contentName: contentLabel(media).name,
        filePath:
            sanitizeText(
                media?.path
            ),
        blockLabel:
            sanitizeText(
                media?.blockLabel,
                120
            ),
        inPointSeconds:
            sanitizeNumber(
                media?.inPoint
            ),
        outPointSeconds:
            sanitizeNumber(
                media?.outPoint,
                sanitizeNumber(
                    media?.duration
                )
            ),
        plannedDurationSeconds:
            sanitizeNumber(
                media?.plannedDurationSeconds
            ),
        startedAt:
            startedAt.toISOString(),
        endedAt: null,
        playedSeconds: 0,
        status: "EM_EXIBICAO",
        reportDate:
            localDateKey(
                startedAt
            )
    };

    state.entries.push(entry);
    saveState();

    return {
        id: entry.id,
        reportDate:
            entry.reportDate,
        reportFolder
    };
}

function finishPlayoutEntry(
    entryId,
    status,
    playedSeconds = 0,
    details = {}
) {
    const normalizedStatus =
        status === "EXECUTADO" ? "EXECUTADO" : status === "PULADO_POR_ERRO" ? "PULADO_POR_ERRO" : "PULADO";

    const entry =
        state.entries.find(
            (item) =>
                item.id === entryId
        );

    if (!entry) {
        return {
            ok: false,
            error:
                "Registro de exibição não encontrado."
        };
    }

    if (
        entry.status !==
        "EM_EXIBICAO"
    ) {
        return {
            ok: true,
            alreadyFinished: true,
            entry
        };
    }

    entry.endedAt =
        new Date().toISOString();
    entry.playedSeconds =
        sanitizeNumber(
            playedSeconds
        );
    entry.status = normalizedStatus;
    entry.errorReason = sanitizeText(details.reason, 1400);
    entry.nextContent = sanitizeText(details.nextContent, 512);
    entry.contingencyContent = sanitizeText(details.contingency, 512);

    saveState();
    queueExport(
        entry.reportDate
    );

    return {
        ok: true,
        entry: {
            ...entry
        },
        reportFolder
    };
}

function markPlayoutEntryReady(id) {
    const entry = state.entries.find(item => item.id === id);
    if (!entry || entry.status !== "EM_EXIBICAO" || entry.actualStartedAt) return;
    entry.attemptedAt = entry.startedAt;
    entry.startedAt = entry.actualStartedAt = new Date().toISOString();
    entry.reportDate = localDateKey(entry.startedAt);
    // Persist together with finish/successor updates. No full-history disk write
    // on the first PROGRAM frame; an abrupt interruption remains identifiable.
}

function updatePlayoutEntrySuccessor(id, content) {
    const entry = state.entries.find(item => item.id === id);
    if (!entry || entry.status !== "PULADO_POR_ERRO") return;
    entry.nextContent = sanitizeText(content, 512); saveState(); queueExport(entry.reportDate);
}

function closeOpenEntriesAsSkipped() {
    const now = new Date();
    const datesToExport =
        new Set();
    let changed = false;

    for (
        const entry
        of state.entries
    ) {
        if (
            entry.status !==
            "EM_EXIBICAO"
        ) {
            continue;
        }

        const started =
            new Date(
                entry.startedAt
            );

        entry.endedAt =
            now.toISOString();
        entry.playedSeconds =
            Math.max(
                0,
                (
                    now.getTime() -
                    started.getTime()
                ) / 1000
            );
        entry.status =
            "PULADO";

        datesToExport.add(
            entry.reportDate
        );
        changed = true;
    }

    if (changed) {
        saveState();

        for (
            const dateKey
            of datesToExport
        ) {
            queueExport(
                dateKey
            );
        }
    }
}

function getReportFolder() {
    return reportFolder;
}

async function listReportFiles() {
    await writeQueue;
    return fs.readdirSync(reportFolder).filter(name => /^Relatorio_Exibicao_\d{4}-\d{2}-\d{2}\.html$/.test(name))
        .sort().reverse().map(name => ({ date: name.slice(19, 29), name }));
}

module.exports = {
    initializePlayoutReports,
    startPlayoutEntry,
    finishPlayoutEntry,
    getPendingFailedReportIds: () => state.entries.filter(entry => entry.status === "PULADO_POR_ERRO" && !entry.nextContent).map(entry => entry.id),
    updatePlayoutEntrySuccessor,
    markPlayoutEntryReady,
    closeOpenEntriesAsSkipped,
    getReportFolder,
    setReportFolder,
    resetReportFolder,
    exportDate,
    writeReportSnapshot,
    listReportFiles
};
