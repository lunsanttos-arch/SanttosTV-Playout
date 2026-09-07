const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ExcelJS = require("exceljs");

let stateFile = "";
let reportFolder = "";
let state = { entries: [] };
let writeQueue = Promise.resolve();

function ensureFolder(folderPath) {
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
    }
}

function initializePlayoutReports({ userDataPath, documentsPath }) {
    const stateFolder = path.join(userDataPath, "reporting");
    reportFolder = path.join(
        documentsPath,
        "Santtos TV",
        "Relatórios de Exibição"
    );
    stateFile = path.join(stateFolder, "playout-report-state.json");

    ensureFolder(stateFolder);
    ensureFolder(reportFolder);

    try {
        if (fs.existsSync(stateFile)) {
            const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
            state.entries = Array.isArray(parsed?.entries)
                ? parsed.entries
                : [];
        }
    } catch (error) {
        console.error("Não foi possível carregar o histórico de exibição:", error);
        state = { entries: [] };
    }

    return {
        reportFolder,
        stateFile
    };
}

function saveState() {
    if (!stateFile) {
        throw new Error("Relatórios de exibição ainda não foram inicializados.");
    }

    ensureFolder(path.dirname(stateFile));
    fs.writeFileSync(
        stateFile,
        JSON.stringify(state, null, 2),
        "utf8"
    );
}

function pad(value) {
    return String(value).padStart(2, "0");
}

function localDateKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localDateLabel(value) {
    const date = value instanceof Date ? value : new Date(value);
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function localTimeLabel(value) {
    const date = value instanceof Date ? value : new Date(value);
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatDuration(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
}

function sanitizeText(value, maxLength = 4096) {
    return typeof value === "string"
        ? value.trim().slice(0, maxLength)
        : "";
}

function sanitizeNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

async function exportDate(dateKey) {
    if (!reportFolder) {
        return;
    }

    const rows = state.entries
        .filter(
            (entry) =>
                entry.reportDate === dateKey &&
                (entry.status === "EXECUTADO" || entry.status === "PULADO")
        )
        .sort((a, b) =>
            new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
        );

    if (rows.length === 0) {
        return;
    }

    ensureFolder(reportFolder);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Santtos TV Automation";
    workbook.created = new Date();
    workbook.modified = new Date();

    const sheet = workbook.addWorksheet("Exibições", {
        views: [{ state: "frozen", ySplit: 1 }]
    });

    sheet.columns = [
        { header: "Data", key: "date", width: 13 },
        { header: "Arquivo", key: "fileName", width: 42 },
        { header: "Bloco", key: "blockLabel", width: 16 },
        { header: "Horário de entrada", key: "startTime", width: 20 },
        { header: "Horário de saída", key: "endTime", width: 20 },
        { header: "Duração prevista", key: "plannedDuration", width: 19 },
        { header: "Duração exibida", key: "playedDuration", width: 19 },
        { header: "Status", key: "status", width: 14 },
        { header: "Caminho", key: "filePath", width: 60 }
    ];

    for (const entry of rows) {
        sheet.addRow({
            date: localDateLabel(entry.startedAt),
            fileName: entry.fileName,
            blockLabel: entry.blockLabel || "",
            startTime: localTimeLabel(entry.startedAt),
            endTime: entry.endedAt ? localTimeLabel(entry.endedAt) : "",
            plannedDuration: formatDuration(entry.plannedDurationSeconds),
            playedDuration: formatDuration(entry.playedSeconds),
            status: entry.status,
            filePath: entry.filePath
        });
    }

    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF202020" }
    };
    header.alignment = { vertical: "middle", horizontal: "center" };
    header.height = 24;

    sheet.autoFilter = {
        from: "A1",
        to: "I1"
    };

    sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        row.alignment = { vertical: "middle" };
        const statusCell = row.getCell(8);
        if (statusCell.value === "PULADO") {
            statusCell.font = { bold: true, color: { argb: "FFB4233A" } };
        } else if (statusCell.value === "EXECUTADO") {
            statusCell.font = { bold: true, color: { argb: "FF248A4B" } };
        }
    });

    const filePath = path.join(
        reportFolder,
        `Relatorio_Exibicao_${dateKey}.xlsx`
    );

    await workbook.xlsx.writeFile(filePath);
    return filePath;
}

function queueExport(dateKey) {
    writeQueue = writeQueue
        .then(() => exportDate(dateKey))
        .catch((error) => {
            console.error("Falha ao atualizar relatório Excel:", error);
        });
    return writeQueue;
}

function startPlayoutEntry(media) {
    const startedAt = new Date();
    const entry = {
        id: crypto.randomUUID(),
        occurrenceId: sanitizeText(media?.id, 240),
        sourceMediaId: sanitizeText(media?.sourceMediaId, 240),
        fileName: sanitizeText(media?.name, 512) || path.basename(sanitizeText(media?.path)),
        filePath: sanitizeText(media?.path),
        blockLabel: sanitizeText(media?.blockLabel, 120),
        inPointSeconds: sanitizeNumber(media?.inPoint),
        outPointSeconds: sanitizeNumber(media?.outPoint, sanitizeNumber(media?.duration)),
        plannedDurationSeconds: sanitizeNumber(media?.plannedDurationSeconds),
        startedAt: startedAt.toISOString(),
        endedAt: null,
        playedSeconds: 0,
        status: "EM_EXIBICAO",
        reportDate: localDateKey(startedAt)
    };

    state.entries.push(entry);
    saveState();

    return {
        id: entry.id,
        reportDate: entry.reportDate,
        reportFolder
    };
}

function finishPlayoutEntry(entryId, status, playedSeconds = 0) {
    const normalizedStatus = status === "EXECUTADO" ? "EXECUTADO" : "PULADO";
    const entry = state.entries.find((item) => item.id === entryId);

    if (!entry) {
        return { ok: false, error: "Registro de exibição não encontrado." };
    }

    if (entry.status !== "EM_EXIBICAO") {
        return { ok: true, alreadyFinished: true, entry };
    }

    entry.endedAt = new Date().toISOString();
    entry.playedSeconds = sanitizeNumber(playedSeconds);
    entry.status = normalizedStatus;
    saveState();
    queueExport(entry.reportDate);

    return {
        ok: true,
        entry: { ...entry },
        reportFolder
    };
}

function closeOpenEntriesAsSkipped() {
    const now = new Date();
    const datesToExport = new Set();
    let changed = false;

    for (const entry of state.entries) {
        if (entry.status !== "EM_EXIBICAO") {
            continue;
        }

        const started = new Date(entry.startedAt);
        entry.endedAt = now.toISOString();
        entry.playedSeconds = Math.max(
            0,
            (now.getTime() - started.getTime()) / 1000
        );
        entry.status = "PULADO";
        datesToExport.add(entry.reportDate);
        changed = true;
    }

    if (changed) {
        saveState();
        for (const dateKey of datesToExport) {
            queueExport(dateKey);
        }
    }
}

function getReportFolder() {
    return reportFolder;
}

module.exports = {
    initializePlayoutReports,
    startPlayoutEntry,
    finishPlayoutEntry,
    closeOpenEntriesAsSkipped,
    getReportFolder
};
