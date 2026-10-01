const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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

    ensureFolder(reportFolder);

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

    for (const entry of state.entries) {
        if (
            entry.status !==
            "EM_EXIBICAO"
        ) {
            continue;
        }

        entry.status = "PULADO";
        entry.endedAt = recoveredAt;
        entry.playedSeconds = 0;
        entry.recoveredAfterCrash = true;
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
                entry.status !== "PULADO"
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
                !fs.existsSync(outputFile) ||
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
    if (!reportFolder) {
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
                        entry.status ===
                            "PULADO"
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

    if (rows.length === 0) {
        return;
    }

    ensureFolder(reportFolder);

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
            reportFolder,
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

function queueExport(dateKey) {
    writeQueue =
        writeQueue
            .then(
                () =>
                    exportDate(
                        dateKey
                    )
            )
            .catch(
                (error) => {
                    console.error(
                        "Falha ao atualizar relatório XML:",
                        error
                    );
                }
            );

    return writeQueue;
}

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
                            entry.status ===
                                "PULADO"
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
    playedSeconds = 0
) {
    const normalizedStatus =
        status === "EXECUTADO"
            ? "EXECUTADO"
            : "PULADO";

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
    entry.status =
        normalizedStatus;

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

module.exports = {
    initializePlayoutReports,
    startPlayoutEntry,
    finishPlayoutEntry,
    closeOpenEntriesAsSkipped,
    getReportFolder,
    setReportFolder,
    resetReportFolder,
    exportDate
};
